# Check-in multiunidade e horário administrável — Design

**Data:** 2026-08-28
**Branch:** `preview/checkin-multiunidade`
**Base de produção:** `354387b9243ab8cfddf6d09871cf4cfa45556bff`
**Status:** Aprovado

## Objetivo

Permitir que cada usuário faça check-in exclusivamente na unidade da Kaizen à
qual foi vinculado e dar aos administradores autonomia para alterar a janela
diária de check-in de cada unidade sem edição de código ou novo deploy. Cada
unidade também deve possuir um QR diário próprio, exibido automaticamente pela
conta de recepção correspondente.

O preview deve ser validável no Vercel sem substituir a Edge Function usada pelo
site atualmente em produção.

## Decisões aprovadas

- Existem inicialmente duas unidades:

| Código | Nome | Latitude | Longitude | Raio | Precisão GPS |
|---|---|---:|---:|---:|---:|
| `zona_oeste` | Zona Oeste | -22.903084 | -43.561000 | 1.000 m | 120 m |
| `zona_norte` | Zona Norte | -22.887190 | -43.282140 | 1.000 m | 120 m |

- Todos os usuários existentes começam vinculados à Zona Oeste.
- Novos usuários também recebem Zona Oeste como padrão até um ADMIN alterar a
  vinculação.
- Cada unidade possui sua própria janela diária de horário, usando o fuso
  `America/Sao_Paulo`.
- As duas unidades começam em 08:00–13:30 e podem ser alteradas de forma
  independente pelo ADMIN.
- Somente o cargo `ADMIN` pode alterar a unidade de um usuário ou o horário.
- A unidade usada pelo check-in é lida do perfil autenticado no servidor; o
  navegador não informa nem escolhe a unidade no momento do check-in.
- O preview usa uma nova função `checkin-geo-v2`; a função `checkin-geo` atual
  permanece intocada durante a validação.
- O cargo existente `RECEPCAO` representa a recepção da Zona Oeste.
- Será criado o novo cargo `RECEPCAO_ZN`, exclusivo da recepção da Zona Norte.
- Ambos os cargos de recepção acessam somente a tela de QR e são redirecionados
  para ela imediatamente após o login.
- `ADMIN`, `DIRETOR` e `GERENTE` mantêm acesso à tela e recebem o QR da unidade
  configurada no próprio perfil.
- O QR da Zona Oeste nunca é aceito para um usuário da Zona Norte e vice-versa.

## Abordagem escolhida

Será usada uma evolução aditiva no mesmo banco Supabase: novas estruturas de
configuração, um vínculo de unidade no perfil, tokens QR por unidade e uma nova
Edge Function. O código de produção atual não consome essas estruturas e
continua chamando a função e o QR globais antigos, evitando que testes no
preview alterem o comportamento do site publicado.

As alternativas rejeitadas foram alterar diretamente `checkin-geo`, pois uma
publicação afetaria produção antes da aprovação, e criar outro projeto Supabase,
pois aumentaria o tempo e a manutenção necessários para este escopo.

## Banco de dados

### `checkin_units`

Tabela que representa as unidades permitidas:

- `code text primary key`
- `name text not null`
- `latitude double precision not null`
- `longitude double precision not null`
- `max_radius_meters integer not null`
- `max_accuracy_meters integer not null`
- `start_minutes smallint not null default 480`
- `end_minutes smallint not null default 810`
- `active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints validam coordenadas, raio, precisão e uma janela com término
posterior ao início. A migration faz `upsert` das duas unidades aprovadas para
que seja idempotente. Na evolução da estrutura já publicada, os novos campos de
horário recebem inicialmente 08:00–13:30 sem alterar os demais dados.

RLS:

- usuários autenticados podem ler unidades ativas;
- somente ADMIN pode inserir ou atualizar unidades;
- remoção não será exposta na interface.

### Vínculo no perfil

`profiles.checkin_unit_code text` referencia `checkin_units(code)`, com padrão
`zona_oeste`. A migration preenche usuários existentes e torna a coluna
obrigatória depois do backfill.

Como a política atual permite que cada usuário atualize o próprio perfil, uma
trigger impede a alteração de `checkin_unit_code` quando o autor não for ADMIN
nem `service_role`. Isso evita que um usuário mude sua própria unidade pelo
console do navegador.

### Compatibilidade com `checkin_settings`

A tabela singleton já publicada possui:

- `id smallint primary key` fixo em `1`;
- `start_minutes smallint not null`, padrão `480` (08:00);
- `end_minutes smallint not null`, padrão `810` (13:30);
- `updated_at timestamptz`;
- `updated_by uuid`, referência opcional a `profiles`.

Ela será preservada sem alterações destrutivas para compatibilidade com o
frontend e a função antigos. A partir desta evolução, o preview lê e grava os
horários em `checkin_units`; `checkin_settings` deixa de ser a fonte do horário
para `checkin-geo-v2`.

### `daily_qr_tokens_by_unit`

Nova tabela paralela aos tokens globais atuais:

- `token_date date not null default current_date`;
- `unit_code text not null references checkin_units(code)`;
- `token text not null unique`;
- `created_at timestamptz not null default now()`;
- chave primária composta por `(token_date, unit_code)`.

Ela armazena exatamente um token por unidade e por dia. A tabela global
`daily_qr_tokens` e suas funções atuais permanecem intactas para compatibilidade
com a produção.

O acesso ocorre somente por duas RPCs `SECURITY DEFINER`, com `search_path`
restrito e sem leitura direta do token por usuários comuns:

- `get_or_create_unit_daily_qr()` não recebe unidade do navegador. Ela lê o
  usuário autenticado e resolve a unidade no servidor: `RECEPCAO` sempre usa
  `zona_oeste`, `RECEPCAO_ZN` sempre usa `zona_norte`, e os cargos de liderança
  usam `profiles.checkin_unit_code`. Retorna token, código e nome da unidade.
- `validate_unit_daily_qr(p_token, p_unit_code)` confirma simultaneamente data,
  token e unidade. Na Edge Function, `p_unit_code` vem do perfil autenticado
  carregado pelo servidor, nunca do body enviado pelo navegador.

Somente `RECEPCAO`, `RECEPCAO_ZN`, `ADMIN`, `DIRETOR` e `GERENTE` podem executar
a RPC de geração/exibição. A validação fica disponível apenas ao fluxo seguro da
Edge Function.

## Cargos e roteamento

O tipo de cargo da aplicação passa a incluir `RECEPCAO_ZN`.

- Ao alterar um perfil para `RECEPCAO`, o Painel Admin também alinha sua unidade
  para `zona_oeste`.
- Ao alterar um perfil para `RECEPCAO_ZN`, o Painel Admin também alinha sua
  unidade para `zona_norte`.
- Os dois cargos são tratados como recepção nas guardas de rota, não recebem o
  layout geral e só permanecem em `/checkin/display`.
- Na interface, o valor técnico `RECEPCAO_ZN` pode ser apresentado como
  `RECEPÇÃO ZN`, sem alterar o valor persistido.
- A unidade é resolvida novamente no banco pela RPC; o redirecionamento do
  frontend não constitui a proteção de segurança.

## Edge Function `checkin-geo-v2`

A nova função mantém autenticação, rate limit, QR diário, proteção contra GPS
impreciso e inserção por `fazer_checkin` existentes. O fluxo passa a ser:

1. Validar o JWT e obter o usuário autenticado.
2. Ler `profiles.checkin_unit_code` pelo cliente `service_role`.
3. Carregar a unidade ativa correspondente em `checkin_units`.
4. Carregar da própria unidade sua janela de início e fim, usando 08:00–13:30
   como fallback seguro apenas se a configuração estiver indisponível.
5. Validar coordenadas e precisão recebidas.
6. Validar o QR diário contra o código da unidade carregada no servidor.
7. Validar o horário em `America/Sao_Paulo`.
8. Calcular Haversine exclusivamente contra as coordenadas da unidade atribuída.
9. Chamar o RPC atômico `fazer_checkin` já existente.
10. Retornar nome da unidade, distância e posição na fila.

Erros específicos:

- perfil sem unidade válida: orientar contato com o administrador;
- unidade inativa ou inexistente: bloquear check-in;
- fora do raio: informar a unidade esperada, distância calculada e limite;
- fora do horário: informar a janela vigente;
- QR de outra unidade: rejeitar como inválido para a unidade atribuída;
- falha de configuração: registrar detalhes apenas no servidor e retornar
  mensagem segura ao usuário.

## Interface administrativa

### Usuários

No card de cada usuário ativo, junto dos seletores organizacionais existentes,
será incluído um seletor `Unidade de check-in` com Zona Oeste e Zona Norte.

- somente ADMIN pode vê-lo e alterá-lo;
- a alteração persiste imediatamente no perfil;
- falha de banco mantém o valor anterior e exibe uma mensagem objetiva;
- usuários inativos continuam com a unidade salva, mas não ganham um novo
  controle separado.
- no desktop, os seis seletores ficam compactos, com altura reduzida e
  distribuídos em uma única linha de colunas iguais;
- em telas estreitas, os seletores continuam quebrando de forma responsiva para
  preservar legibilidade e área de toque.
- o seletor de cargo inclui `RECEPCAO_ZN`; escolher qualquer cargo de recepção
  alinha automaticamente o seletor de unidade correspondente.

### Aba Check-in

Será adicionada uma aba `Check-in` ao Painel Administrativo, disponível apenas
para ADMIN. Ela exibe:

- um bloco independente para Zona Oeste e outro para Zona Norte;
- horário inicial e final em cada bloco;
- resumo da tolerância de distância e precisão da respectiva unidade;
- botão de salvar próprio para cada unidade, com feedback de carregamento,
  sucesso e erro.

A aba permanece na posição atual da barra superior do Painel Administrativo.
Não serão criados atalhos, modais ou mudanças na navegação neste ajuste.

Latitude, longitude, raio e precisão não serão editáveis nesta primeira versão,
pois o pedido aprovado definiu valores fixos e a autonomia solicitada é para o
horário. Isso reduz risco de um erro operacional bloquear toda uma unidade.

## Tela de check-in

A tela passa a mostrar, quando o usuário estiver autenticado:

- a unidade atribuída;
- a janela de horário configurada para essa unidade;
- mensagens da Edge Function v2.

O frontend chamará `checkin-geo-v2` nesta branch. Nenhuma decisão de segurança
depende da unidade exibida no navegador.

## Tela de exibição do QR

`CheckInDisplay` continua sendo a tela inicial automática das contas de
recepção, mas passa a consumir `get_or_create_unit_daily_qr()`.

Ela mostra de forma inequívoca:

- `QR Code — Zona Oeste` para `RECEPCAO`;
- `QR Code — Zona Norte` para `RECEPCAO_ZN`;
- a unidade definida no perfil para `ADMIN`, `DIRETOR` e `GERENTE`;
- a janela de horário da unidade exibida;
- a contagem para a renovação do token à meia-noite.

O QR contém a URL de check-in com o token, como hoje. Não é necessário incluir
ou confiar em um parâmetro de unidade na URL, pois o vínculo do token é validado
no servidor.

## Compatibilidade e implantação

- A branch nasce do commit que a Vercel confirmou como produção, não de `main`.
- O push da branch aciona um deployment Preview na Vercel.
- As mudanças SQL são aditivas e não são consumidas pelo frontend atual.
- `checkin-geo` não será sobrescrita durante o preview.
- `daily_qr_tokens`, `get_or_create_daily_qr()` e `validate_daily_qr()` não serão
  alteradas durante o preview.
- A nova migration e `checkin-geo-v2` serão publicadas no projeto Supabase
  vinculado antes do frontend atualizado.
- Como o Supabase é compartilhado, durante a validação a conta
  `RECEPCAO_ZN` deve usar exclusivamente o endereço de preview. O frontend de
  produção ainda não conhece esse cargo até uma futura promoção; a conta da
  recepção atual não será convertida para o novo cargo durante o teste.

## Testes e critérios de aceite

Os testes serão curtos e direcionados às regras críticas:

- conversão e validação da janela de horário por unidade;
- cálculo de distância e bloqueio pela unidade atribuída;
- impossibilidade de escolher outra unidade no payload;
- geração de tokens diferentes para as duas unidades no mesmo dia;
- rejeição do QR de uma unidade quando o perfil pertence à outra;
- resolução de `RECEPCAO` como Oeste e `RECEPCAO_ZN` como Norte;
- fallback controlado do horário;
- build Vite/TypeScript.

UAT do preview:

1. ADMIN troca um usuário de Zona Oeste para Zona Norte e o valor persiste após
   recarregar a página.
2. Usuário da Zona Norte é aceito dentro de 1.000 m da Zona Norte e rejeitado na
   Zona Oeste.
3. Usuário da Zona Oeste é aceito dentro de 1.000 m da Zona Oeste e rejeitado na
   Zona Norte.
4. ADMIN configura horários diferentes para as duas unidades, recarrega a
   página e encontra os mesmos valores.
5. Edge e tela usam a janela da unidade atribuída, sem misturar configurações.
6. Não-ADMIN não vê nem consegue gravar as configurações.
7. Login `RECEPCAO` abre diretamente o QR identificado como Zona Oeste.
8. Login `RECEPCAO_ZN` abre diretamente o QR identificado como Zona Norte.
9. Os dois QRs do mesmo dia são diferentes.
10. Usuário da Zona Norte não consegue usar o QR da Zona Oeste, nem o inverso.
11. ADMIN, DIRETOR e GERENTE veem o QR da unidade definida no próprio perfil.
12. O endereço de produção continua chamando a função e o QR globais antigos
    durante o preview.

## Fora de escopo

- horários diferentes por dia da semana;
- escolha de unidade pelo usuário durante o check-in;
- mapa para editar coordenadas;
- mais de um QR por unidade no mesmo dia;
- escolha manual de unidade na tela de exibição do QR;
- alteração da lógica de distribuição;
- projeto Supabase separado para preview.
