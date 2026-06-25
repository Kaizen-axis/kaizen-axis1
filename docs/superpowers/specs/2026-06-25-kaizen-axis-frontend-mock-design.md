# KAIZEN-AXIS — Versão Frontend-Only com Dados Mockados

**Data:** 2026-06-25
**Status:** Aprovado (design)
**Autor:** Engenharia reversa do app KAIZEN-AXIS

## Objetivo

Produzir uma cópia navegável do app KAIZEN-AXIS que rode **100% no frontend, sem
backend** (sem Supabase, sem OpenAI, sem APIs serverless). Todas as 28 telas
funcionando com dados-semente realistas (mercado imobiliário do RJ), CRUD em
memória, e login fake com troca de papel.

Casos de uso: demonstração comercial, prototipagem de UI, onboarding, deploy
estático (Vercel/Netlify) sem credenciais.

## Restrições e princípios

- **Não tocar no projeto original.** Trabalho feito numa cópia em pasta nova.
- **Mínima alteração de código de telas.** As páginas e componentes de UI não são
  reescritos — apenas a camada de acesso a dados é substituída.
- **YAGNI:** sem persistência real, sem push real, sem MFA real. Recursos que
  dependem de APIs externas degradam graciosamente.
- **Fidelidade visual total:** a UI é a mesma do app real.

## Descoberta — onde o frontend toca o backend

Mapeamento do código-fonte (`src/`, 35 arquivos, 251 chamadas):

| Seam | Volume | Detalhe |
|---|---|---|
| `supabase.from(...)` | 102 chamadas, ~30 tabelas | query-builder PostgREST: `.select/.insert/.update/.delete/.eq/.neq/.in/.or/.ilike/.gte/.lte/.order/.limit/.single/.maybeSingle/.range/.contains/.is` |
| `supabase.auth` | ~33 chamadas | `getSession`, `getUser`, `onAuthStateChange`, `signOut`, `signUp`, `setSession`, `updateUser`, `mfa.*` |
| `supabase.storage` | 16 chamadas | `from().upload`, `createSignedUrl`, `remove` |
| `supabase.channel` (realtime) | 5 canais | chat + system_events |
| `supabase.rpc` | 9 chamadas | ex.: `admin_set_profile_team` |
| `fetch('/api/apuracao')` | 1 endpoint | cálculo de comissão / apuração de renda |
| `services/kaiAgent.ts` → OpenAI | IA do chat / resumos | |

Tabelas referenciadas (~30): `profiles, clients, leads, teams, trainings,
achievements, developments, tasks, goals, chat_messages, chat_groups,
chat_group_members, chat_message_reactions, notifications, directorates,
announcements, portals, client_documents, client_history, client_proponents,
appointments, avatars, training_completions, sales_mirrors, daily_checkins,
checkin_always_present_users, audit_logs, user_achievements, security_events,
push_subscriptions, leaderboard, income_audits`.

**Insight-chave:** todos os 35 arquivos importam o cliente Supabase do **mesmo
módulo** `src/lib/supabase.ts`. Substituir esse único módulo por um cliente falso
mantém os outros 34 arquivos **intactos**.

## Approach escolhido — Mock Supabase Client

Substituir `src/lib/supabase.ts` por um shim em memória que imita a superfície da
API do Supabase usada pelo app. Considerados e rejeitados: (B) reescrever
AppContext + cada página — diff enorme, alto risco; (C) telas estáticas hardcoded
— perde CRUD/navegação.

## Arquitetura da cópia

Pasta nova: `KAIZEN-AXIS-mock/` (cópia do projeto, sem `node_modules`, `.git`,
`dist`, relatórios de segurança, scripts n8n, `api/`, `server/`, `supabase/`).

```
src/
  lib/supabase.ts        ← SUBSTITUÍDO: mock client (query-builder + auth + storage + realtime + rpc)
  mock/
    db.ts                ← estado in-memory: { [tabela]: Row[] }, clonado do seed no boot
    seed.ts              ← dados-semente realistas PT-BR / RJ (~30 tabelas)
    queryBuilder.ts      ← engine PostgREST-like (filtros, order, joins por embed select)
    auth.ts              ← sessão fake, troca de papel, localStorage
  services/
    kaiAgent.ts          ← SUBSTITUÍDO: respostas canned
  components/
    DevRoleSwitcher.tsx   ← botão flutuante p/ trocar papel/usuário (NOVO)
api/apuracao (front)      ← interceptado: fetch('/api/apuracao') resolvido por mock local
```

### Mock Supabase client (`src/lib/supabase.ts`)

Exporta `supabase` com a mesma forma do cliente real:

- `from(table)` → retorna um *thenable* query-builder encadeável. Acumula
  operação (select/insert/update/delete) + filtros (eq, neq, in, or, ilike, gte,
  lte, gt, lt, contains, is) + modifiers (order, limit, range). Resolve via
  `await` ou `.then()` para `{ data, error }`. Suporta `.single()` /
  `.maybeSingle()`. Suporta embeds do tipo
  `select('*, history:client_history(*)')` resolvendo joins por FK convencional.
- `auth`:
  - `getSession()` → sessão fake atual (ou null).
  - `getUser()` → user fake.
  - `onAuthStateChange(cb)` → registra callback, retorna `{ data: { subscription: { unsubscribe } } }`.
  - `signInWithPassword` / `signUp` → cria sessão fake, dispara callbacks.
  - `signOut()` → limpa sessão.
  - `updateUser`, `setSession` → no-op que atualiza estado fake.
  - `mfa.*` → stub "nenhum fator" (`listFactors` vazio) p/ Settings/Security não quebrarem.
- `storage.from(bucket)`:
  - `upload(path, file)` → guarda `URL.createObjectURL(file)` num mapa; retorna `{ data: { path } }`.
  - `createSignedUrl(path)` → retorna object URL salvo ou placeholder.
  - `remove` → no-op ok.
- `channel(name)` → objeto com `.on().subscribe()` no-op, `removeChannel` no-op.
- `rpc(name, args)` → tabela de handlers canned por nome conhecido; default `{ data: null, error: null }`.

Erros sempre `null` no caminho feliz; formato `{ data, error }` preservado.

### Dados-semente (`src/mock/seed.ts`)

Realistas, em português, mercado imobiliário do RJ. Volume alvo p/ telas ricas:

- **profiles:** ~12 usuários cobrindo todos os papéis (ADMIN, DIRETOR, GERENTE,
  COORDENADOR, CORRETOR×N, ANALISTA, RECEPCAO, EXPORTADOR), com equipes/diretorias.
- **directorates / teams:** 2 diretorias, 3-4 equipes com membros.
- **clients:** ~25 clientes distribuídos por todos os estágios do funil
  (Documentação, Em Análise, Aprovado, Condicionado, Contrato, Concluído, etc.),
  com histórico, proponentes e documentos fake.
- **leads:** ~10 leads de automação (origens: WhatsApp, Portal, Indicação) com
  `aiSummary` e níveis de interesse.
- **developments:** ~8 empreendimentos plausíveis (construtoras e bairros do RJ),
  com faixas de preço/renda, diferenciais, contato.
- **appointments:** agenda da semana corrente (datas relativas a hoje).
- **tasks:** ~10 tarefas em vários status, com subtarefas.
- **goals:** metas individuais e de equipe (vendas / clientes aprovados).
- **chat:** conversas + mensagens, grupos.
- **trainings / training_completions:** trilha de capacitação com XP.
- **achievements / user_achievements / leaderboard:** gamificação.
- **announcements, portals, notifications.**
- **daily_checkins / checkin_always_present_users:** presença.
- **audit_logs / security_events:** alguns registros p/ o painel admin.
- **reports / income_audits / sales_mirrors:** métricas p/ Relatórios e Apuração.

Datas dinâmicas (relativas a `new Date()`) para a agenda e dashboards parecerem
"vivos".

### Auth fake + troca de papel (`src/mock/auth.ts` + `DevRoleSwitcher`)

- Sessão fake persistida em `localStorage` (`mock_session`).
- Login (`Login.tsx`) aceita qualquer credencial → cria sessão do usuário ADMIN
  por padrão, navega normalmente.
- `DevRoleSwitcher`: widget flutuante (canto da tela) que troca o `profile` ativo
  entre os usuários-semente de cada papel, re-disparando `onAuthStateChange`.
  Permite validar os fluxos por papel (ex.: ANALISTA só vê /income; RECEPCAO vai
  pra /checkin/display; EXPORTADOR vai pra /exportador).

### Stubs de serviços externos

- `services/kaiAgent.ts` → respostas canned em PT-BR (resumo de cliente, sugestão
  de mensagem), com pequeno delay simulado.
- `fetch('/api/apuracao')` → interceptado por um helper local que devolve um JSON
  de apuração coerente com a UI (ou ajuste em `IncomeAnalysis.tsx` p/ chamar o
  mock direto, se o intercept de fetch for frágil).
- `services/rateLimiter.ts` e `services/auditLogger.ts` → como gravam em tabelas
  via o mesmo `supabase` mock, funcionam sem alteração (gravam em memória).

## Fluxo de dados

Página → `useApp()` / chamada direta a `supabase` → mock client → `db`
(in-memory) → `{ data, error }` → setState → UI. Idêntico ao real, sem rede.
Mutations (insert/update/delete) alteram `db` e refletem após o `refresh*()` que
as telas já chamam.

## Tratamento de erros / degradação

- Recursos que dependem de binários/APIs externas (OCR Tesseract, leitura de PDF,
  geração de PDF) continuam client-side e funcionam; o que dependia de storage
  real recebe placeholders.
- Realtime: sem updates ao vivo (no-op) — aceitável; o app já refaz fetch.
- MFA/push: stubs neutros; telas renderizam sem travar.

## Verificação

1. `npm install` na pasta nova.
2. `npm run dev` (porta 3000) + preview.
3. Navegação: Login → Dashboard → Clientes (Kanban) → ClientDetails → Leads →
   Agenda → Tarefas → Empreendimentos → Relatórios → Admin → Chat → Gamificação.
4. Troca de papel via DevRoleSwitcher e verificação dos guards de rota.
5. Um CRUD de ponta a ponta (criar cliente, mover de estágio).
6. `npm run lint` (tsc --noEmit) sem erros novos.
7. Entrega de screenshots como prova.

## Fora de escopo

- Persistência entre reloads (reset proposital ao recarregar).
- Integrações reais (Supabase, OpenAI, MercadoPago, C6, n8n).
- Push notifications reais, MFA real.
- Testes automatizados das páginas (apenas verificação manual + lint).

## Critérios de sucesso

- App roda com `npm run dev` sem nenhuma variável de ambiente / credencial.
- Todas as 28 rotas renderizam sem crash, com dados realistas.
- Login fake + troca entre todos os papéis funcionam, respeitando os guards.
- Pelo menos um fluxo CRUD funciona em memória.
- Original em `KAIZEN-AXIS/` permanece intocado.
