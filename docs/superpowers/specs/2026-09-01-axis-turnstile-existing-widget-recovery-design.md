# Recuperação do Turnstile existente do Kaizen Axis

**Data:** 2026-09-01  
**Status:** aprovado pelo proprietário para implementação  
**Escopo:** login e recuperação de senha do Kaizen Axis em Vercel + Supabase gerenciado

## Problema

O baseline de produção usava o widget Cloudflare `Kaizen-axis`, sitekey
`0x4AAAAAADOmmf-tlgTOstXw`, em modo `managed`. Durante a migração foram criados
dois widgets adicionais e a produção passou a usar
`imobkaizen-axis-auth-managed-20260831`. Em navegadores desktop, o desafio pode
ficar carregando por muito tempo e terminar com o erro cliente `300030`.

Os hotfixes também passaram a exibir `Carregando verificação de segurança...`
e a manter o botão desabilitado enquanto nenhum token é recebido. Essa mensagem
não causa a demora; ela apenas expõe o estado de espera. O baseline funcional não
exibia esse texto e não condicionava a habilitação visual do botão ao token.

O dashboard da Cloudflare também informa que não observou chamadas Siteverify
para o widget antigo. O código do baseline e o código atual possuem validação
server-side; como a produção deixou de emitir tokens pelo widget antigo, a falta
de métricas desse widget não explica o erro `300030`, que ocorre antes da emissão
do token.

## Decisão

Recuperar o widget existente `Kaizen-axis`; não criar outro widget.

Alternativas rejeitadas:

- Manter o widget novo e continuar ajustando retries: já houve várias tentativas
  sem resolver o comportamento entre navegadores.
- Desligar CAPTCHA: restaura disponibilidade, mas remove uma proteção obrigatória.
- Criar outro widget: aumenta novamente a divergência entre sitekey, secret e
  ambientes.

## Configuração Cloudflare

Preservar nome, sitekey, secret e modo `managed` do widget `Kaizen-axis`.
Atualizar sua lista de hostnames para conter:

- `kaizen-axis.space`
- `www.kaizen-axis.space`
- `kaizen-axis1.vercel.app`
- `app.imobkaizen.com.br`
- `staging-app.imobkaizen.com.br`
- `rehearsal-app.imobkaizen.com.br`
- `localhost`
- `127.0.0.1`

O backend de produção não aceitará `localhost` nem `127.0.0.1` em sua allowlist
de hostname. Esses dois nomes existem somente para diagnóstico local.

## Configuração Vercel e Supabase

- Vercel `kaizen-axis1`: definir `VITE_TURNSTILE_SITE_KEY` para a sitekey antiga.
- Supabase `pwvpxxrvlywlneuijmmd`: recuperar sem exposição e definir o secret do
  mesmo widget em `TURNSTILE_SECRET_KEY`.
- Manter `REQUIRE_CAPTCHA=true`.
- Definir `TURNSTILE_HOSTNAMES` apenas com os frontends remotos aprovados.
- Manter as Edge Functions `secure-login` e `send-password-reset` como únicas
  responsáveis pela chamada server-side ao Siteverify.
- Não repassar o mesmo token ao GoTrue após ele ser consumido pelas Edge Functions.

O secret será obtido pelo fluxo oficial de widget existente, validado com token
dummy e enviado ao secret manager por entrada padrão/conexão HTTPS, sem aparecer
em argumentos, logs, arquivos temporários, commits ou chat.

## Frontend

Manter renderização explícita do Turnstile com `action: axis_auth` e o widget em
modo visível/managed. Aproximar o ciclo de vida do baseline funcional:

- remover o texto permanente `Carregando verificação de segurança...`;
- não desabilitar visualmente o botão apenas porque o token ainda não chegou;
- se o usuário enviar antes do token, impedir a requisição no cliente e informar
  que a verificação precisa ser concluída;
- manter o backend fail-closed, portanto nenhuma requisição sem token válido
  autentica;
- reter o ID do widget e executar `turnstile.reset(widgetId)` após tentativa de
  login/recuperação, pois tokens são de uso único;
- preservar mensagem de erro e retry manual apenas quando o callback da
  Cloudflare realmente retornar um código.

## Testes antes da implementação

Adicionar/alterar testes para falharem antes da mudança e comprovarem:

- a interface não contém a mensagem de carregamento permanente;
- o botão não fica desabilitado somente pela ausência do token;
- nenhuma submissão chama o backend sem token quando há sitekey configurada;
- `action: axis_auth` continua sendo enviado;
- `secure-login` e `send-password-reset` chamam Siteverify;
- o backend exige `success`, `action` e hostname aprovado;
- token ausente, inválido, expirado ou repetido é rejeitado.

## Rollout

1. Registrar metadados atuais do widget, Vercel, Supabase e deployment de rollback.
2. Atualizar somente os hostnames do widget antigo.
3. Recuperar e validar o secret antigo sem expô-lo.
4. Aplicar sitekey/secret primeiro em um deployment Preview com hostname autorizado.
5. Validar Chrome, Edge, Edge InPrivate e Safari mobile.
6. Fazer um login real com token fresco e repetir o mesmo token para provar rejeição.
7. Confirmar que Turnstile Analytics passou a registrar Siteverify para
   `Kaizen-axis`.
8. Promover exatamente o artefato aprovado para produção.
9. Manter o deployment atual disponível para rollback imediato.

## Critérios de sucesso

- Widget aparece sem espera prolongada em todos os navegadores da matriz.
- Nenhum erro `300030` durante a aceitação.
- Login real funciona no desktop e mobile.
- Siteverify registra sucesso para token fresco.
- Replay do token é rejeitado.
- Siteverify rejeita action ou hostname divergente.
- Nenhum secret aparece em código, logs ou evidências.
- Nenhuma mudança de DNS, Supabase self-hosted ou cutover ocorre nesta correção.

## Manifesto de escrita protegido

- Projeto: `C:/Users/hokma/OneDrive/Desktop/PROJETOS/MIGRATION-WORKTREES/kaizen-axis`
- Widget: `Kaizen-axis`
- Sitekey: `0x4AAAAAADOmmf-tlgTOstXw`
- Destinos: Cloudflare hostname management, Vercel `kaizen-axis1` e secrets do
  Supabase `pwvpxxrvlywlneuijmmd`.
- Wrangler exigido pelo fluxo oficial: versão `4.109.0` ou posterior, instalado
  fora do projeto em caminho canônico aprovado.
- Estado atual: nenhum Wrangler canônico está instalado nesta máquina; sua
  instalação exige aprovação explícita antes da recuperação do secret.
