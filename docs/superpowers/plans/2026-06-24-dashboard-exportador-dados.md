# Dashboard do Exportador + Export Total de Dados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que uma conta dedicada (papel `EXPORTADOR`) baixe sob demanda um pacote `.zip` com todos os dados de negócio do app (CSV + JSON + documentos com links + relatórios), sem acesso ao restante do sistema.

**Architecture:** Uma Edge Function (`export-all-data`) usando service role lê todas as tabelas de negócio, monta o `.zip`, sobe num bucket privado (`data-exports`) e devolve uma URL assinada de curta validade. O frontend tem uma página isolada `/exportador` com um botão de download. O papel `EXPORTADOR` fica travado nessa rota.

**Tech Stack:** Supabase (Postgres + Storage + Edge Functions/Deno), `npm:jszip`, React + TypeScript + Vite, React Router. Spec: `docs/superpowers/specs/2026-06-24-dashboard-exportador-dados-design.md`.

**Branch:** `preview/exportador` (já criada, base `preview/v3`). Não tocar `main`.

**Nota sobre testes:** o projeto não tem suíte de testes unitários; o gate é `npm run build`. A função Deno e o fluxo são validados por UAT manual (Task 6). Migration e deploy só ao final.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20260624120000_create_data_exports_bucket.sql` | Criar | Bucket privado `data-exports` |
| `supabase/functions/export-all-data/index.ts` | Criar | Gera o pacote e devolve URL assinada |
| `src/hooks/useAuthorization.ts` | Modificar | Papel `EXPORTADOR` + `isExportador` |
| `src/pages/ExportadorDashboard.tsx` | Criar | Página `/exportador` com botão de download |
| `src/App.tsx` | Modificar | Rota `/exportador` + travar o papel `EXPORTADOR` |

---

## Task 1: Migration — bucket privado `data-exports`

**Files:**
- Create: `supabase/migrations/20260624120000_create_data_exports_bucket.sql`

- [ ] **Step 1: Criar o arquivo de migration**

```sql
-- Bucket privado para os pacotes de exportação gerados pela função export-all-data.
-- Sem acesso público: o download só ocorre via URL assinada gerada com service role.
insert into storage.buckets (id, name, public)
values ('data-exports', 'data-exports', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Revisar** — bucket `public = false`; idempotente (`on conflict do nothing`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260624120000_create_data_exports_bucket.sql
git commit -m "feat(exportador): bucket privado data-exports"
```

---

## Task 2: Edge Function `export-all-data`

**Files:**
- Create: `supabase/functions/export-all-data/index.ts`

- [ ] **Step 1: Criar a função completa**

Crie `supabase/functions/export-all-data/index.ts` com o conteúdo exato:

```ts
// @ts-nocheck — Deno types não disponíveis no checker local; válido em runtime.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import JSZip from 'npm:jszip@3';

const CORS_ORIGIN = Deno.env.get('APP_ORIGIN') ?? '';
const corsHeaders = {
  'Access-Control-Allow-Origin': CORS_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
  'Vary': 'Origin',
};

const EXPORT_BUCKET = 'data-exports';
const DOCS_BUCKET = 'client-documents';
const DAILY_LIMIT = 5;
const SIGNED_TTL = 600;       // link do zip: 10 min (download é imediato)
const DOC_SIGNED_TTL = 3600;  // links de documentos: 1h (ficam dentro do zip baixado)

// Tabelas de negócio incluídas no pacote (exclui logs, chat, tokens, base do Kai).
const TABLES = [
  'clients', 'client_proponents', 'client_history', 'client_documents',
  'appointments', 'tasks', 'leads', 'sales_events', 'sales_mirrors', 'approved_events',
  'developments', 'profiles', 'teams', 'directorates', 'daily_checkins', 'goals',
  'missions_templates', 'income_audits', 'user_points', 'user_achievements',
  'achievements', 'sales_streaks', 'trainings', 'training_completions',
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function resolveIp(req: Request) {
  const f = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip');
  return f ? (f.split(',')[0]?.trim() || '0.0.0.0') : '0.0.0.0';
}

function toCsv(rows: Record<string, any>[]): string {
  if (!rows || rows.length === 0) return '';
  const headerSet = new Set<string>();
  for (const r of rows) Object.keys(r).forEach((k) => headerSet.add(k));
  const headers = Array.from(headerSet);
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Proteção contra CSV/formula injection: neutraliza células que o Excel
    // interpretaria como fórmula (=, +, -, @, tab, CR) prefixando com aspa simples.
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h])).join(','));
  return lines.join('\r\n');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Não autorizado' }, 401);
  const token = authHeader.slice(7);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Configuração do servidor ausente' }, 500);

  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'Não autorizado' }, 401);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // Gate por papel
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = String(prof?.role || '').toUpperCase();
  if (role !== 'EXPORTADOR' && role !== 'ADMIN') return json({ error: 'Acesso restrito.' }, 403);

  // Rate limit diário
  const dayStart = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000).toISOString();
  const { data: cnt, error: rlErr } = await admin.rpc('increment_request_counter', {
    _scope: 'data_export', _identifier: user.id, _window_start: dayStart,
  });
  if (rlErr) return json({ error: 'Falha ao aplicar limite de segurança' }, 500);
  if ((cnt ?? 0) > DAILY_LIMIT) return json({ error: 'Limite diário de exportações atingido. Tente amanhã.' }, 429);

  const zip = new JSZip();
  const counts: Record<string, number> = {};
  const notes: string[] = [];
  const fullData: Record<string, any[]> = {};

  // Tabelas -> CSV + acumula no JSON
  for (const t of TABLES) {
    try {
      const { data, error } = await admin.from(t).select('*');
      if (error) { notes.push(`Tabela ${t}: erro (${error.message})`); continue; }
      const rows = data || [];
      counts[t] = rows.length;
      fullData[t] = rows;
      zip.file(`csv/${t}.csv`, toCsv(rows));
    } catch (e) { notes.push(`Tabela ${t}: falha (${(e as any)?.message})`); }
  }

  // documentos.csv com links de download temporários
  try {
    const docs = fullData['client_documents'] || [];
    const docRows: Record<string, any>[] = [];
    for (const d of docs) {
      let link = '';
      const path = String(d.url || '')
        .replace(/^\/object\/public\/client-documents\//, '')
        .replace(/^client-documents\//, '')
        .trim();
      if (path) {
        const { data: signed } = await admin.storage.from(DOCS_BUCKET).createSignedUrl(path, DOC_SIGNED_TTL);
        link = signed?.signedUrl || '';
      }
      docRows.push({ id: d.id, client_id: d.client_id, name: d.name, type: d.type, path: d.url, download_link: link });
    }
    zip.file('documentos.csv', toCsv(docRows));
  } catch (e) { notes.push(`documentos: ${(e as any)?.message}`); }

  // Relatórios consolidados (best-effort)
  for (const rpc of ['get_report_metrics', 'get_presence_report', 'get_relatorio_diretoria']) {
    try {
      const { data, error } = await admin.rpc(rpc);
      if (error) { notes.push(`Relatório ${rpc}: ${error.message}`); continue; }
      zip.file(`relatorios/${rpc}.json`, JSON.stringify(data, null, 2));
    } catch (e) { notes.push(`Relatório ${rpc}: ${(e as any)?.message}`); }
  }

  // JSON completo
  zip.file('dados-completos.json', JSON.stringify(fullData, null, 2));

  // LEIA-ME
  const generatedAt = new Date().toISOString();
  const readme = [
    'KAIZEN AXIS — Exportação de dados',
    `Gerado em: ${generatedAt}`,
    '',
    'Conteúdo do pacote:',
    '- csv/            : um arquivo CSV por conjunto de dados',
    '- dados-completos.json : todos os dados estruturados (para migração)',
    '- documentos.csv  : lista de documentos + links de download temporários (validade ~1h)',
    '- relatorios/     : relatórios consolidados',
    '',
    'Contagens por conjunto:',
    ...Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`),
    '',
    'AVISO (LGPD): este pacote contém DADOS PESSOAIS de clientes e da equipe,',
    'incluindo CPF. Quem baixa é responsável pelo armazenamento e tratamento',
    'em conformidade com a Lei Geral de Proteção de Dados.',
    notes.length ? '\nObservações de geração:' : '',
    ...notes.map((n) => `- ${n}`),
  ].join('\n');
  zip.file('LEIA-ME.txt', readme);

  // Gera o zip
  const bytes = await zip.generateAsync({ type: 'uint8array' });

  // Limpeza: remove pacotes anteriores (mantém no máximo o mais recente no bucket)
  try {
    const { data: prev } = await admin.storage.from(EXPORT_BUCKET).list('exportador', { limit: 100 });
    const toRemove = (prev || []).map((o) => `exportador/${o.name}`);
    if (toRemove.length) await admin.storage.from(EXPORT_BUCKET).remove(toRemove);
  } catch (e) { notes.push(`limpeza de exports anteriores: ${(e as any)?.message}`); }

  // Upload no bucket privado
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const objectPath = `exportador/kaizen-axis-export-${stamp}.zip`;
  const { error: upErr } = await admin.storage.from(EXPORT_BUCKET).upload(objectPath, bytes, {
    contentType: 'application/zip', upsert: true,
  });
  if (upErr) { console.error('[export-all-data] upload', upErr.message); return json({ error: 'Falha ao gerar o pacote.' }, 500); }

  const { data: signed, error: signErr } = await admin.storage.from(EXPORT_BUCKET).createSignedUrl(objectPath, SIGNED_TTL);
  if (signErr || !signed?.signedUrl) return json({ error: 'Falha ao gerar o link de download.' }, 500);

  // Auditoria (aguardada — operação sensível não fica sem registro)
  const { error: auditErr } = await admin.from('audit_logs').insert({
    user_id: user.id, action: 'data_export', entity: 'export', entity_id: null,
    ip_address: resolveIp(req), device_info: req.headers.get('user-agent') || 'unknown',
    metadata: { counts, notes, object_path: objectPath },
  });
  if (auditErr) console.warn('[export-all-data] audit insert failed', auditErr.message);

  return json({ url: signed.signedUrl, generated_at: generatedAt, counts });
});
```

- [ ] **Step 2: Revisar** — gate por papel (`EXPORTADOR`/`ADMIN`), rate limit `data_export` (5/dia), CSV+JSON+documentos+relatórios+LEIA-ME, upload no bucket privado, URL assinada. Reforços de segurança: **proteção contra formula injection** no `esc`, **TTL curto (10 min)** do zip, **limpeza dos pacotes anteriores** antes do upload, **auditoria aguardada (`await`)**. (Build do frontend não cobre Deno; validação real é na Task 6.)

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/export-all-data/index.ts
git commit -m "feat(exportador): edge function export-all-data (zip + url assinada)"
```

---

## Task 3: Papel `EXPORTADOR` no `useAuthorization`

**Files:**
- Modify: `src/hooks/useAuthorization.ts`

- [ ] **Step 1: Adicionar o papel ao tipo `UserRole`**

Substitua a linha 3:

```ts
export type UserRole = 'ADMIN' | 'DIRETOR' | 'GERENTE' | 'COORDENADOR' | 'CORRETOR' | 'RECEPCAO' | 'ANALISTA' | 'EXPORTADOR';
```

- [ ] **Step 2: Adicionar `isExportador`**

Logo após a linha `const isAnalyst = role === 'ANALISTA';` (linha 18), adicione:

```ts
    const isExportador = role === 'EXPORTADOR';
```

- [ ] **Step 3: Expor no retorno do hook**

No objeto retornado, logo após `isAnalyst,` (linha 67), adicione:

```ts
        isExportador,
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build conclui sem novos erros de TypeScript.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAuthorization.ts
git commit -m "feat(exportador): papel EXPORTADOR no useAuthorization"
```

---

## Task 4: Página `/exportador` + roteamento

**Files:**
- Create: `src/pages/ExportadorDashboard.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Criar a página `ExportadorDashboard.tsx`**

Crie `src/pages/ExportadorDashboard.tsx`:

```tsx
import { useState } from 'react';
import { RoundedButton } from '@/components/ui/PremiumComponents';
import { Download, Loader2, ShieldCheck, LogOut } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/context/AppContext';
import { useNavigate } from 'react-router-dom';

export default function ExportadorDashboard() {
  const { signOut } = useApp();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<string | null>(null);

  const handleExport = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('export-all-data', { body: {} });
      if (fnError) {
        let message = 'Não foi possível gerar a exportação agora. Tente novamente.';
        try {
          const resp = (fnError as any).context;
          if (resp) { const j = await resp.json().catch(() => ({})); message = j?.error || message; }
        } catch { /* mantém genérica */ }
        throw new Error(message);
      }
      if (!data?.url) throw new Error('Resposta inválida do servidor.');
      setLastAt(data.generated_at || new Date().toISOString());
      // Inicia o download
      const a = document.createElement('a');
      a.href = data.url;
      a.rel = 'noopener';
      a.click();
    } catch (e: any) {
      setError(e?.message || 'Erro ao exportar.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => { await signOut(); navigate('/login'); };

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg bg-card-bg rounded-3xl shadow-xl p-8 space-y-6">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-500">
            <ShieldCheck size={22} />
          </span>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Exportação de Dados</h1>
            <p className="text-sm text-text-secondary">Kaizen Axis</p>
          </div>
        </div>

        <p className="text-sm text-text-secondary leading-relaxed">
          Baixe um pacote <strong>.zip</strong> com todos os dados do sistema: clientes, agendamentos,
          leads, vendas, empreendimentos, equipe, presença e relatórios. Inclui os dados em
          <strong> CSV</strong> (abrem no Excel) e em <strong>JSON</strong> (para migração), além da
          lista de documentos com links de download.
        </p>

        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-400">
          O pacote contém dados pessoais (incluindo CPF). Guarde-o com segurança e trate conforme a LGPD.
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <RoundedButton fullWidth onClick={handleExport} disabled={loading} className="py-4 text-base font-semibold">
          {loading ? <Loader2 size={20} className="animate-spin" /> : <><Download size={18} /> Baixar todos os dados</>}
        </RoundedButton>

        {lastAt && !loading && (
          <p className="text-center text-xs text-text-secondary">
            Última exportação: {new Date(lastAt).toLocaleString('pt-BR')}
          </p>
        )}

        <button onClick={handleLogout} className="flex items-center justify-center gap-2 w-full text-sm text-text-secondary hover:text-text-primary transition-colors pt-2">
          <LogOut size={16} /> Sair
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Importar a página no `App.tsx`**

Junto aos outros imports de páginas (após `import ResetPassword from '@/pages/ResetPassword';`, linha ~34), adicione:

```ts
import ExportadorDashboard from '@/pages/ExportadorDashboard';
```

- [ ] **Step 3: Travar o papel `EXPORTADOR` no `ProtectedRoute`**

Em `src/App.tsx`, no componente `ProtectedRoute`, logo após o bloco do `RECEPCAO` (que termina antes de `if (isAnalyst) {`), adicione um bloco análogo. Localize:

```tsx
  if (role === 'RECEPCAO') {
    if (location.pathname !== '/checkin/display') {
      return <Navigate to="/checkin/display" replace />;
    }
    return <>{children}</>;
  }
```

E **logo abaixo** dele, insira:

```tsx
  if (role === 'EXPORTADOR') {
    if (location.pathname !== '/exportador') {
      return <Navigate to="/exportador" replace />;
    }
    return <>{children}</>;
  }
```

- [ ] **Step 4: Travar o papel `EXPORTADOR` no `RoleRoute`**

Ainda em `src/App.tsx`, no componente `RoleRoute`, localize o bloco idêntico do `RECEPCAO` (logo após a checagem `if (!allowed.includes(role)) return <Navigate to="/" replace />;`):

```tsx
  if (role === 'RECEPCAO') {
    if (location.pathname !== '/checkin/display') {
      return <Navigate to="/checkin/display" replace />;
    }
    return <>{children}</>;
  }
```

E **logo abaixo** dele, insira:

```tsx
  if (role === 'EXPORTADOR') {
    if (location.pathname !== '/exportador') {
      return <Navigate to="/exportador" replace />;
    }
    return <>{children}</>;
  }
```

- [ ] **Step 5: Registrar a rota `/exportador`**

Em `src/App.tsx`, junto às rotas com `RoleRoute` (perto de `/admin`), adicione:

```tsx
        <Route path="/exportador" element={
          <RoleRoute allowed={['EXPORTADOR', 'ADMIN']}>
            <ExportadorDashboard />
          </RoleRoute>
        } />
```

- [ ] **Step 6: Verificar build**

Run: `npm run build`
Expected: build conclui sem novos erros.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ExportadorDashboard.tsx src/App.tsx
git commit -m "feat(exportador): pagina /exportador isolada + roteamento do papel"
```

---

## Task 5: Build final consolidado

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: `✓ built in ...s` sem novos erros de TypeScript.

- [ ] **Step 2: Revisar os commits da branch**

Run: `git log --oneline preview/v3..HEAD`
Expected: commits das Tasks 1–4 presentes.

---

## Task 6: Aplicação no ambiente + criação da conta + UAT

> Aplicar somente no projeto Supabase do usuário após revisão. Produção (`main`) não é afetada pelo código.

- [ ] **Step 1: Aplicar a migration** (SQL Editor ou Management API): confirmar o bucket
```sql
select id, public from storage.buckets where id = 'data-exports';  -- deve existir, public=false
```

- [ ] **Step 2: Deploy da função** (usa JWT internamente — pode deployar com verificação padrão)
```bash
supabase functions deploy export-all-data
```

- [ ] **Step 3: Criar a conta do EXPORTADOR**
  - Criar o usuário (e-mail/senha) para o cliente (via cadastro no app ou Supabase Auth) e definir o papel:
    ```sql
    update public.profiles set role = 'EXPORTADOR', status = 'Ativo' where id = '<uuid-do-usuario>';
    ```
  - **Segurança da conta (definido pelo admin, fora do código):** ativar **MFA/2FA** nessa conta, usar senha forte e mantê-la **dedicada/não compartilhada** — é o ponto crítico (um login extrai todos os dados).

- [ ] **Step 4: UAT**
  - [ ] Logar com a conta `EXPORTADOR` → cai direto em `/exportador` e **não** consegue abrir nenhuma outra rota.
  - [ ] Clicar em "Baixar todos os dados" → recebe o `.zip`.
  - [ ] Conferir o conteúdo: `csv/*.csv`, `dados-completos.json`, `documentos.csv` (com links que baixam), `relatorios/*.json`, `LEIA-ME.txt` (com contagens e aviso LGPD).
  - [ ] Verificar registro em `audit_logs` (`action = 'data_export'`).
  - [ ] Acionar 6 vezes no mesmo dia → a 6ª retorna limite (`429`).
  - [ ] Logar como `ADMIN` e confirmar que também consegue exportar.
  - [ ] **Formula injection:** cadastrar um cliente de teste com nome começando por `=` (ex.: `=1+1`) e confirmar que no CSV exportado a célula sai como texto (`'=1+1`), sem executar no Excel.
  - [ ] **Limpeza/TTL:** após exportar, conferir que há **apenas um** objeto em `data-exports/exportador/`; aguardar >10 min e confirmar que a URL anterior **expirou** (`400/403`).

- [ ] **Step 5: Push da branch**
```bash
git push -u origin preview/exportador
```

---

## Self-Review (autor do plano)

- **Cobertura da spec:** papel EXPORTADOR + isExportador (Task 3) ✓; conta isolada/travada na rota (Task 4, ProtectedRoute+RoleRoute) ✓; edge function com gate de papel, rate limit, auditoria, CSV+JSON+documentos(links)+relatórios+LEIA-ME, bucket privado, URL assinada (Task 2) ✓; bucket (Task 1) ✓; página com botão (Task 4) ✓; deploy + criação de conta + UAT (Task 6) ✓; exclusão de tabelas técnicas (lista `TABLES` na Task 2) ✓.
- **Reforços de segurança aplicados:** proteção contra CSV/formula injection (`esc`), TTL do zip reduzido para 10 min, limpeza dos pacotes anteriores antes do upload, auditoria aguardada (`await`), e recomendação de MFA na conta (Task 6, fora do código). ✓
- **Placeholders:** nenhum — todo passo tem código/comando concretos.
- **Consistência de tipos:** `EXPORTADOR` usado igual em `UserRole`, `useAuthorization`, `App.tsx` e na função; rota `/exportador` e bucket `data-exports` consistentes entre tasks; escopo de rate limit `data_export` igual em função e UAT.
