# Check-in multiunidade e horário administrável — Design

**Data:** 2026-08-28
**Branch:** `preview/checkin-multiunidade`
**Base de produção:** `354387b9243ab8cfddf6d09871cf4cfa45556bff`
**Status:** Aprovado

## Objetivo

Permitir que cada usuário faça check-in exclusivamente na unidade da Kaizen à
qual foi vinculado e dar aos administradores autonomia para alterar a janela
diária de check-in sem edição de código ou novo deploy.

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
- A janela de horário é global para as duas unidades e usa o fuso
  `America/Sao_Paulo`.
- Somente o cargo `ADMIN` pode alterar a unidade de um usuário ou o horário.
- A unidade usada pelo check-in é lida do perfil autenticado no servidor; o
  navegador não informa nem escolhe a unidade no momento do check-in.
- O preview usa uma nova função `checkin-geo-v2`; a função `checkin-geo` atual
  permanece intocada durante a validação.

## Abordagem escolhida

Será usada uma evolução aditiva no mesmo banco Supabase: novas estruturas de
configuração, um vínculo de unidade no perfil e uma nova Edge Function. O código
de produção atual não consome essas estruturas e continua chamando a função
antiga, evitando que testes no preview alterem o comportamento do site publicado.

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
- `active boolean not null default true`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints validam coordenadas, raio e precisão. A migration faz `upsert` das
duas unidades aprovadas para que seja idempotente.

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

### `checkin_settings`

Tabela singleton com:

- `id smallint primary key` fixo em `1`;
- `start_minutes smallint not null`, padrão `480` (08:00);
- `end_minutes smallint not null`, padrão `810` (13:30);
- `updated_at timestamptz`;
- `updated_by uuid`, referência opcional a `profiles`.

O banco exige horários entre `00:00` e `23:59` e término posterior ao início.
Qualquer autenticado pode ler a janela para exibi-la, mas somente ADMIN pode
alterá-la.

A migration será nova e tolerará a existência de uma versão anterior de
`checkin_settings`, preservando o horário que já estiver salvo.

## Edge Function `checkin-geo-v2`

A nova função mantém autenticação, rate limit, QR diário, proteção contra GPS
impreciso e inserção por `fazer_checkin` existentes. O fluxo passa a ser:

1. Validar o JWT e obter o usuário autenticado.
2. Ler `profiles.checkin_unit_code` pelo cliente `service_role`.
3. Carregar a unidade ativa correspondente em `checkin_units`.
4. Carregar a janela global de `checkin_settings`, usando 08:00–13:30 como
   fallback apenas se a configuração estiver indisponível.
5. Validar coordenadas e precisão recebidas.
6. Validar o QR diário.
7. Validar o horário em `America/Sao_Paulo`.
8. Calcular Haversine exclusivamente contra as coordenadas da unidade atribuída.
9. Chamar o RPC atômico `fazer_checkin` já existente.
10. Retornar nome da unidade, distância e posição na fila.

Erros específicos:

- perfil sem unidade válida: orientar contato com o administrador;
- unidade inativa ou inexistente: bloquear check-in;
- fora do raio: informar a unidade esperada, distância calculada e limite;
- fora do horário: informar a janela vigente;
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

### Aba Check-in

Será adicionada uma aba `Check-in` ao Painel Administrativo, disponível apenas
para ADMIN. Ela exibe:

- horário inicial;
- horário final;
- resumo das duas unidades e suas tolerâncias;
- botão `Salvar horário` com feedback de carregamento, sucesso e erro.

Latitude, longitude, raio e precisão não serão editáveis nesta primeira versão,
pois o pedido aprovado definiu valores fixos e a autonomia solicitada é para o
horário. Isso reduz risco de um erro operacional bloquear toda uma unidade.

## Tela de check-in

A tela passa a mostrar, quando o usuário estiver autenticado:

- a unidade atribuída;
- a janela de horário configurada;
- mensagens da Edge Function v2.

O frontend chamará `checkin-geo-v2` nesta branch. Nenhuma decisão de segurança
depende da unidade exibida no navegador.

## Compatibilidade e implantação

- A branch nasce do commit que a Vercel confirmou como produção, não de `main`.
- O push da branch aciona um deployment Preview na Vercel.
- As mudanças SQL são aditivas e não são consumidas pelo frontend atual.
- `checkin-geo` não será sobrescrita durante o preview.
- Para validar o fluxo completo, a migration e `checkin-geo-v2` precisam ser
  publicadas no projeto Supabase vinculado.
- A credencial CLI disponível durante o levantamento respondeu `403`; se isso
  persistir, a branch será entregue pronta e os dois comandos de publicação
  serão informados para execução por uma conta proprietária.

## Testes e critérios de aceite

Os testes serão curtos e direcionados às regras críticas:

- conversão e validação da janela de horário;
- cálculo de distância e bloqueio pela unidade atribuída;
- impossibilidade de escolher outra unidade no payload;
- fallback controlado do horário;
- build Vite/TypeScript.

UAT do preview:

1. ADMIN troca um usuário de Zona Oeste para Zona Norte e o valor persiste após
   recarregar a página.
2. Usuário da Zona Norte é aceito dentro de 1.000 m da Zona Norte e rejeitado na
   Zona Oeste.
3. Usuário da Zona Oeste é aceito dentro de 1.000 m da Zona Oeste e rejeitado na
   Zona Norte.
4. ADMIN altera início/fim, recarrega a página e encontra os mesmos valores.
5. Edge e tela usam a nova janela.
6. Não-ADMIN não vê nem consegue gravar as configurações.
7. O endereço de produção continua chamando a função antiga durante o preview.

## Fora de escopo

- horários diferentes por unidade ou dia da semana;
- escolha de unidade pelo usuário durante o check-in;
- mapa para editar coordenadas;
- alteração do QR diário ou da lógica de distribuição;
- projeto Supabase separado para preview.
