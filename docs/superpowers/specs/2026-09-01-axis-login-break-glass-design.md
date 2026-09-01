# Break-glass seguro do login do Kaizen Axis

**Data:** 2026-09-01
**Status:** aprovado pelo proprietario para execucao
**Branch:** `hotfix/axis-login-break-glass-20260901`
**Baseline de producao:** commit `81ad216596b8cf0794fc62a1ea6144f42b677a20`, deployment `dpl_DPudFscaojnvaymCuvfP8sJpjgX9`

## Objetivo

Restaurar o login de usuarios reais quando o Cloudflare Turnstile falha antes de
emitir um token, sem transformar a indisponibilidade do provedor de CAPTCHA em
uma liberacao geral dos fluxos de autenticacao.

O break-glass remove temporariamente apenas a obrigatoriedade do Turnstile no
login de usuarios existentes. Senha, rate limit, MFA, bloqueio de inativos e o
bloqueio de cadastro publico permanecem como controles independentes.

## Evidencia do incidente

- O deployment atualmente publicado usa o commit `81ad216` e o widget antigo
  `Kaizen-axis`, mas `getCaptchaTokenIfRequired()` ainda bloqueia login sem token.
- O erro cliente `300030` ocorre antes de Siteverify e foi reproduzido em Edge
  normal e InPrivate, inclusive com a chave oficial de teste e fora do bundle do
  Axis.
- O gate anterior registrou `FAIL` e decidiu nao reativar Turnstile como requisito
  de producao, mas mudancas posteriores voltaram a exigir o token.
- Um break-glass anterior sem Turnstile comprovou login real em desktop e mobile.
- O Supabase gerenciado esta atualmente com cadastro publico habilitado e CAPTCHA
  nativo desabilitado. Portanto, simplesmente apagar o sitekey do frontend
  exporia o cadastro e nao e aceitavel.

## Limites de seguranca atuais

O rate limit do `secure-login` e server-side: 10 tentativas por 60 segundos por
IP. Erro na RPC do contador retorna erro e impede a chamada ao password grant.

O fluxo atual de MFA e a verificacao de usuario inativo acontecem no cliente
depois que o password grant emite uma sessao AAL1. Nao foi encontrado enforcement
geral de AAL2 nas politicas RLS. Este incidente nao tentara reescrever toda a
arquitetura de MFA, mas nao declarara uma garantia server-side inexistente. O
bloqueio de inativos sera endurecido no backend antes de a sessao ser devolvida.

## Decisao

### Login de usuarios existentes

Adicionar uma flag exclusiva, `LOGIN_REQUIRE_CAPTCHA`, consumida somente por
`secure-login`. A ausencia da flag significa `true`; somente o valor literal
`false` ativa o break-glass. O secret e a allowlist do Turnstile permanecem no
secret manager para rollback imediato.

No frontend, `VITE_LOGIN_REQUIRE_CAPTCHA` segue a mesma semantica fail-closed:
ausencia significa `true`. Quando o valor for `false`, o login nao renderiza nem
exige o widget e invoca `secure-login` sem token. Nenhuma falha dinamica do script
ou callback ativa bypass; somente configuracao explicita o faz.

### Rate limit

O contador por IP permanece antes do password grant. O hotfix adiciona testes que
comprovam:

- contador executado antes da autenticacao;
- contador com erro impede o password grant;
- limite atingido retorna `429`;
- CAPTCHA desabilitado nao pula o contador.

### Usuarios inativos

Depois de credenciais validas e antes de devolver tokens, `secure-login` consulta
o perfil pelo `user.id` usando o cliente administrativo. Perfil `inativo` ou
`inactive` provoca revogacao da sessao emitida e resposta `403`. Erro ao consultar
o perfil falha fechado e nao devolve tokens.

A verificacao do cliente permanece como defesa adicional, mas deixa de ser a
unica barreira desse fluxo.

### MFA

O fluxo atual AAL1 -> desafio TOTP -> AAL2 nao sera removido nem contornado. A
promocao exige login real de uma conta com fator verificado e comprovacao de que
o aplicativo nao conclui a navegacao sem o segundo fator.

A ausencia de enforcement AAL2 geral em RLS sera registrada como finding critico
separado. Ela e preexistente e nao sera mascarada como resolvida pelo break-glass.

### Cadastro e recuperacao de senha

Antes de abrir o login sem CAPTCHA, o cadastro publico sera desabilitado no
Supabase (`disable_signup=true`) e removido da interface durante o break-glass.
Uma chamada direta a `auth.signUp` deve ser rejeitada pelo servidor.

A recuperacao de senha nao recebera bypass. O endpoint continua protegido pelo
Turnstile e por seu rate limit de 5 pedidos por 60 segundos por IP. Como o widget
nao sera exibido no modo de login durante o break-glass, o controle de recuperacao
ficara temporariamente indisponivel na interface, com orientacao para suporte.

## Sequencia de rollout

1. Congelar metadados sanitizados de Vercel, Supabase e Git, incluindo rollback.
2. Criar testes inicialmente falhos para a flag fail-closed, rate limit, inativos,
   cadastro bloqueado e frontend sem widget apenas no modo break-glass.
3. Implementar e validar localmente.
4. Publicar primeiro a nova versao de `secure-login` com a flag ausente. Como a
   ausencia significa `true`, essa etapa deve preservar o comportamento atual.
5. Definir `disable_signup=true` e provar rejeicao server-side de cadastro.
6. Definir `LOGIN_REQUIRE_CAPTCHA=false`, executar imediatamente os probes de
   rate limit/inativos e publicar Preview Vercel com
   `VITE_LOGIN_REQUIRE_CAPTCHA=false`. A producao visual continua exigindo o
   widget durante essa janela curta, mas chamadas diretas ao backend ja ficam sob
   os controles compensatorios certificados.
7. Executar testes tecnicos e login real em Chrome, Edge, Edge InPrivate e Safari
   mobile, incluindo uma conta MFA e um usuario sintetico inativo.
8. Gerar um build production-target do mesmo commit com a flag de frontend
   desabilitada, testar sua URL antes do alias e promover esse artefato.

## Gates de promocao

Todos os itens abaixo devem passar:

- credenciais invalidas retornam `401`, sem erro de CAPTCHA;
- 10 tentativas por 60 segundos por IP continuam limitadas com `429`;
- falha do contador bloqueia autenticacao;
- usuario inativo retorna `403` e os tokens emitidos sao revogados;
- conta MFA nao conclui entrada sem segundo fator;
- cadastro publico e rejeitado server-side;
- recuperacao de senha continua sem bypass;
- bundle de login nao carrega Turnstile no modo break-glass;
- login real funciona nos quatro navegadores da matriz;
- nenhum secret ou token aparece em arquivos, argumentos, logs ou evidencias.

## Rollback

O rollback nao depende de recuperar secrets:

1. definir `LOGIN_REQUIRE_CAPTCHA=true` no Supabase;
2. promover a versao anterior de `secure-login` se necessario;
3. definir `VITE_LOGIN_REQUIRE_CAPTCHA=true` e realiasar o deployment anterior;
4. restaurar `disable_signup=false` somente depois que o Turnstile voltar a ser
   requisito e a matriz de navegadores passar;
5. repetir login, MFA, inativos, cadastro e recuperacao antes de encerrar o
   incidente.

## Fora de escopo

- cutover de DNS, Tunnel, Vercel ou Supabase self-hosted;
- alteracao de banco ou Storage da migracao;
- desativacao de Vercel ou Supabase gerenciado;
- reescrita completa das politicas RLS para AAL2;
- criacao de outro widget Turnstile.

## Criterio de conclusao

O incidente de disponibilidade termina quando usuarios existentes conseguem
entrar em producao nos navegadores-alvo e os controles compensatorios acima estao
comprovados. O incidente de Turnstile permanece aberto ate uma correcao separada
passar por canary, token real, rejeicao de replay e pela matriz completa.
