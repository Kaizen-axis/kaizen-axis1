# Dashboard do Exportador + Export Total de Dados — Design

**Data:** 2026-06-24
**Branch:** `preview/exportador` (base: `preview/v3`)
**Status:** Aprovado

## Problema / contexto

O cliente (dono do negócio) pediu acesso aos dados do app para garantir **continuidade** caso o desenvolvedor fique indisponível. O objetivo é dar a ele uma forma autônoma de **baixar todos os dados críticos** (clientes, agendamentos, leads, vendas, relatórios, etc.) **sem** lhe dar acesso ao código de execução nem à infraestrutura (variáveis de ambiente, deploy).

Solução: um **papel dedicado** (`EXPORTADOR`) com uma **conta isolada** que só acessa um dashboard de exportação, e uma **Edge Function** que monta e entrega um pacote completo dos dados sob demanda.

> Nota de negócio: este recurso entrega os **dados** (que pertencem à empresa do cliente e incluem dados pessoais — LGPD), não o código/infra. A proteção contra "copiar o código e parar de pagar" continua sendo **contrato escrito + controle das chaves/infra**, fora do escopo desta feature.

## Escopo

**Incluído:**
- Novo papel `EXPORTADOR`, conta isolada travada na rota `/exportador`.
- Página de dashboard com botão "Baixar todos os dados".
- Edge Function `export-all-data` que gera `.zip` (CSV por conjunto + JSON completo + relatórios + lista de documentos com links temporários) e devolve link assinado.
- Auditoria e rate limit da exportação.

**Fora de escopo (YAGNI):**
- Backup agendado automático.
- Limpeza automática de exports antigos do bucket (melhoria futura).
- Inclusão dos arquivos binários de documentos no zip (usaremos links temporários).
- Export seletivo por período/filtro (sempre exporta tudo).

## Dados incluídos vs. excluídos

**Incluídos (negócio):** `clients`, `client_proponents`, `client_history`, `client_documents` (+links), `appointments`, `tasks`, `leads`, `sales_events`, `sales_mirrors`, `approved_events`, `developments`, `profiles` (equipe — **com CPF**, conforme decisão), `teams`, `directorates`, `daily_checkins`, `goals`, `missions_templates`, `income_audits`, e gamificação (`user_points`, `user_achievements`, `achievements`, `sales_streaks`, `trainings`, `training_completions`). Relatórios consolidados via RPCs existentes (`get_report_metrics`, `get_presence_report`, `get_relatorio_diretoria`).

**Excluídos (técnico/interno):** `audit_logs`, `security_events`, `system_events`, `request_throttles`, `push_subscriptions`, `daily_qr_tokens`, `chat_*`, `n8n_chat_histories`, `wa_conversations`, `kai_knowledge_chunks`, `message_history`, `followup_log`.

## Arquitetura

Edge Function server-side (`export-all-data`) usando service role para ler tudo (sem precisar afrouxar RLS para o papel `EXPORTADOR`). O frontend só dispara e baixa.

```
[/exportador (frontend)] --POST JWT--> [export-all-data (Edge, service role)]
                                              | lê tabelas + RPCs de relatório
                                              | gera CSVs + JSON + documentos.csv(links) + LEIA-ME
                                              | zip -> bucket privado data-exports/
                                              v
                                       devolve { url assinada (TTL ~1h) }
[frontend] <----- link de download -----------
```

### 1. Papel `EXPORTADOR` (banco + auth)
- Conta criada com `role = 'EXPORTADOR'` (campo texto já existente em `profiles`).
- Não recebe nenhuma policy de leitura ampla — o acesso aos dados é só via a Edge Function (service role). As policies de RLS existentes não precisam incluir esse papel (ele não navega no app).

### 2. Frontend
- **`useAuthorization`**: adicionar `isExportador` (role === 'EXPORTADOR').
- **`App.tsx`**:
  - Nova rota `/exportador` protegida (`RoleRoute allowed={['EXPORTADOR','ADMIN']}`).
  - Em `ProtectedRoute` e `RoleRoute`: se `role === 'EXPORTADOR'`, **travar** o usuário em `/exportador` (redirecionar qualquer outra rota para lá), espelhando o comportamento atual do papel `RECEPCAO`.
- **`src/pages/ExportadorDashboard.tsx`** (novo): título, explicação do conteúdo do pacote, data do último export, botão "Baixar todos os dados" com estados loading/erro; ao receber a URL assinada, inicia o download.

### 3. Edge Function `export-all-data` (`supabase/functions/export-all-data/index.ts`)
- `POST`, CORS via `APP_ORIGIN`. Exige `Authorization: Bearer <jwt>`; valida via `auth.getUser`.
- Confere `profiles.role ∈ {EXPORTADOR, ADMIN}`; caso contrário `403`.
- **Rate limit** por usuário via `increment_request_counter` (escopo `data_export`, ex.: 5/dia) → `429`.
- **Auditoria**: insere em `audit_logs` (`action='data_export'`, user, ip, metadata com contagens).
- Lê as tabelas incluídas (service role) e as RPCs de relatório.
- Monta no zip:
  - `csv/<tabela>.csv` (um por conjunto)
  - `dados-completos.json` (tudo)
  - `documentos.csv` (registros + URL assinada por documento, TTL curto)
  - `relatorios/*.csv`
  - `LEIA-ME.txt` (data de geração, descrição, aviso LGPD/responsabilidade)
- Compacta (lib zip no Deno), faz upload em bucket **privado** `data-exports/exportador/<timestamp>.zip`.
- Retorna `200 { url, generated_at, counts }` com **URL assinada** (TTL ~1h).
- Erros: `401` (sem auth), `403` (papel), `429` (limite), `500` (falha de geração).

### 4. Storage
- Bucket privado `data-exports` (criado via migration/SQL). Sem acesso público; download só por URL assinada.

## Tratamento de erros
- Falha de geração/upload → `500` + mensagem; dashboard oferece "tentar novamente".
- Documentos como links (não binários) evita estouro de memória/tempo na função.
- Se uma tabela/RPC específica falhar, registra no `LEIA-ME.txt` e continua (export parcial > falha total).

## Segurança / LGPD
- Papel `EXPORTADOR` não tem leitura ampla no banco; tudo passa pela função validada.
- Bucket privado + URL assinada de curta validade.
- Toda exportação auditada.
- Pacote contém dados pessoais (clientes e equipe, com CPF) — `LEIA-ME.txt` traz aviso de responsabilidade.

## Estratégia de branch e deploy
- Trabalho em `preview/exportador` (base `preview/v3`).
- Migration (bucket) e deploy da função aplicados após validação no preview. Produção não é afetada até promoção.

## Testes
- `npm run build` como gate de compilação.
- UAT: login como `EXPORTADOR` cai direto em `/exportador` e não acessa mais nada; botão gera o `.zip`; conteúdo confere (CSVs + JSON + documentos com links + relatórios + LEIA-ME); rate limit e auditoria funcionando; ADMIN também consegue gerar.
