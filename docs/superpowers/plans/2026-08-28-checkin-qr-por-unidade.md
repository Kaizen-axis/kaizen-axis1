# QR de Check-in por Unidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o cargo `RECEPCAO_ZN`, gerar um QR diário exclusivo para cada unidade e rejeitar qualquer QR que não pertença à unidade atribuída ao usuário.

**Architecture:** Uma tabela e duas RPCs v2 serão adicionadas em paralelo à infraestrutura global de QR existente. A RPC de exibição resolve a unidade pelo usuário autenticado; a Edge Function resolve a unidade do usuário que faz check-in e valida token + data + unidade. O frontend centraliza o catálogo de cargos para tratar `RECEPCAO` e `RECEPCAO_ZN` de forma consistente nas rotas, no Painel Admin e na tela de QR.

**Tech Stack:** React 19, TypeScript, React Router, Tailwind CSS, Supabase/Postgres/RLS/RPC, Supabase Edge Functions (Deno), Deno test runner, Vercel.

---

## Estrutura de arquivos

- Criar `src/lib/auth/userRoles.ts`: catálogo tipado de cargos, labels e mapeamento dos cargos de recepção para unidade.
- Criar `src/lib/auth/userRoles.test.ts`: regressões do novo cargo e do mapeamento Oeste/Norte.
- Modificar `src/hooks/useAuthorization.ts`: reconhecer os dois cargos como recepção.
- Modificar `src/App.tsx`: redirecionar ambos para a tela de QR e autorizar `RECEPCAO_ZN` nessa rota.
- Criar `supabase/migrations/20260828173000_checkin_unit_daily_qr.sql`: tabela de tokens por unidade e RPCs seguras de geração/validação.
- Modificar `src/pages/admin/AdminPanel.tsx`: disponibilizar o novo cargo e alinhar cargo/unidade nas alterações e aprovações.
- Modificar `src/pages/CheckInDisplay.tsx`: consumir o QR v2 e mostrar unidade/horário dinâmicos.
- Modificar `supabase/functions/checkin-geo-v2/index.ts`: validar o token contra a unidade resolvida no servidor.

### Task 1: Catálogo de cargos e guardas de rota

**Files:**
- Create: `src/lib/auth/userRoles.test.ts`
- Create: `src/lib/auth/userRoles.ts`
- Modify: `src/hooks/useAuthorization.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Escrever o teste RED do novo cargo**

Criar `src/lib/auth/userRoles.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getReceptionUnitCode,
  getUserRoleLabel,
  isReceptionRole,
  normalizeUserRole,
  USER_ROLE_OPTIONS,
} from './userRoles.ts';

describe('user role catalog', () => {
  it('maps each reception role to its fixed unit', () => {
    assert.equal(getReceptionUnitCode('RECEPCAO'), 'zona_oeste');
    assert.equal(getReceptionUnitCode('recepcao_zn'), 'zona_norte');
    assert.equal(getReceptionUnitCode('GERENTE'), null);
  });

  it('recognizes both reception roles and exposes the new option', () => {
    assert.equal(isReceptionRole('RECEPCAO'), true);
    assert.equal(isReceptionRole('RECEPCAO_ZN'), true);
    assert.equal(isReceptionRole('CORRETOR'), false);
    assert.equal(USER_ROLE_OPTIONS.some(option => option.value === 'RECEPCAO_ZN'), true);
    assert.equal(getUserRoleLabel('RECEPCAO_ZN'), 'RECEPÇÃO ZN');
  });

  it('normalizes known roles and safely defaults unknown values', () => {
    assert.equal(normalizeUserRole(' recepcao_zn '), 'RECEPCAO_ZN');
    assert.equal(normalizeUserRole('cargo_invalido'), 'CORRETOR');
  });
});
```

- [ ] **Step 2: Executar o teste e confirmar a falha esperada**

Run:

```powershell
deno test --no-config src/lib/auth/userRoles.test.ts
```

Expected: FAIL com `Module not found` para `userRoles.ts`.

- [ ] **Step 3: Implementar o catálogo mínimo de cargos**

Criar `src/lib/auth/userRoles.ts`:

```ts
export const USER_ROLE_OPTIONS = [
  { value: 'CORRETOR', label: 'CORRETOR' },
  { value: 'COORDENADOR', label: 'COORDENADOR' },
  { value: 'GERENTE', label: 'GERENTE' },
  { value: 'DIRETOR', label: 'DIRETOR' },
  { value: 'ADMIN', label: 'ADMIN' },
  { value: 'RECEPCAO', label: 'RECEPÇÃO' },
  { value: 'RECEPCAO_ZN', label: 'RECEPÇÃO ZN' },
  { value: 'ANALISTA', label: 'ANALISTA' },
] as const;

export type UserRole = typeof USER_ROLE_OPTIONS[number]['value'];
export type ReceptionRole = Extract<UserRole, 'RECEPCAO' | 'RECEPCAO_ZN'>;

const ROLE_VALUES = new Set<string>(USER_ROLE_OPTIONS.map(option => option.value));
const RECEPTION_UNIT_BY_ROLE: Record<ReceptionRole, 'zona_oeste' | 'zona_norte'> = {
  RECEPCAO: 'zona_oeste',
  RECEPCAO_ZN: 'zona_norte',
};

export function normalizeUserRole(value: unknown): UserRole {
  const normalized = String(value ?? '').trim().toUpperCase();
  return ROLE_VALUES.has(normalized) ? normalized as UserRole : 'CORRETOR';
}

export function isReceptionRole(value: unknown): value is ReceptionRole {
  const normalized = String(value ?? '').trim().toUpperCase();
  return normalized === 'RECEPCAO' || normalized === 'RECEPCAO_ZN';
}

export function getReceptionUnitCode(value: unknown): 'zona_oeste' | 'zona_norte' | null {
  const normalized = String(value ?? '').trim().toUpperCase();
  return isReceptionRole(normalized) ? RECEPTION_UNIT_BY_ROLE[normalized] : null;
}

export function getUserRoleLabel(value: unknown): string {
  const normalized = normalizeUserRole(value);
  return USER_ROLE_OPTIONS.find(option => option.value === normalized)?.label ?? normalized;
}
```

- [ ] **Step 4: Integrar o catálogo no hook de autorização**

Em `src/hooks/useAuthorization.ts`, importar e reexportar o tipo:

```ts
import {
  isReceptionRole,
  normalizeUserRole,
  type UserRole,
} from '@/lib/auth/userRoles';

export type { UserRole } from '@/lib/auth/userRoles';
```

Substituir o cast atual por:

```ts
const role: UserRole = normalizeUserRole(profile?.role);
const isReception = isReceptionRole(role);
```

Os demais booleanos permanecem derivados de `role`.

- [ ] **Step 5: Proteger o roteamento dos dois cargos**

Em `src/App.tsx`, usar `isReception` tanto em `ProtectedRoute` quanto em
`RoleRoute`, no lugar de `role === 'RECEPCAO'`:

```tsx
const { role, isAnalyst, isReception } = useAuthorization();

if (isReception) {
  if (location.pathname !== '/checkin/display') {
    return <Navigate to="/checkin/display" replace />;
  }
  return <>{children}</>;
}
```

Na rota, acrescentar o novo cargo:

```tsx
<RoleRoute allowed={['ADMIN', 'DIRETOR', 'GERENTE', 'RECEPCAO', 'RECEPCAO_ZN']}>
  <CheckInDisplay />
</RoleRoute>
```

- [ ] **Step 6: Confirmar GREEN, sintaxe e commit**

Run:

```powershell
deno test --no-config src/lib/auth/userRoles.test.ts
deno eval --no-config "import ts from 'npm:typescript@5.8.3'; for (const f of ['src/hooks/useAuthorization.ts','src/App.tsx']) { const s=await Deno.readTextFile(f); const r=ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,fileName:f}); if((r.diagnostics??[]).some(d=>d.category===ts.DiagnosticCategory.Error)) Deno.exit(1); } console.log('TS syntax OK');"
```

Expected: teste PASS e `TS syntax OK`.

```powershell
git add src/lib/auth/userRoles.ts src/lib/auth/userRoles.test.ts src/hooks/useAuthorization.ts src/App.tsx
git commit -m "feat(auth): adiciona recepcao da zona norte"
```

### Task 2: Tokens QR diários por unidade

**Files:**
- Create: `supabase/migrations/20260828173000_checkin_unit_daily_qr.sql`

- [ ] **Step 1: Criar tabela aditiva e protegida**

Iniciar a migration com:

```sql
CREATE TABLE IF NOT EXISTS public.daily_qr_tokens_by_unit (
  token_date  date NOT NULL DEFAULT ((now() AT TIME ZONE 'America/Sao_Paulo')::date),
  unit_code   text NOT NULL REFERENCES public.checkin_units(code),
  token       text NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (token_date, unit_code),
  UNIQUE (token)
);

ALTER TABLE public.daily_qr_tokens_by_unit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_qr_tokens_by_unit FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.daily_qr_tokens_by_unit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.daily_qr_tokens_by_unit TO service_role;
```

Não alterar `daily_qr_tokens`, `get_or_create_daily_qr()` ou
`validate_daily_qr()`.

- [ ] **Step 2: Criar a RPC que resolve a unidade no servidor**

Adicionar à mesma migration:

```sql
CREATE OR REPLACE FUNCTION public.get_or_create_unit_daily_qr()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role          text;
  v_profile_unit  text;
  v_unit_code     text;
  v_unit_name     text;
  v_start_minutes smallint;
  v_end_minutes   smallint;
  v_token         text;
  v_today         date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  SELECT UPPER(COALESCE(role, '')), checkin_unit_code
  INTO v_role, v_profile_unit
  FROM public.profiles
  WHERE id = auth.uid();

  IF v_role = 'RECEPCAO' THEN
    v_unit_code := 'zona_oeste';
  ELSIF v_role = 'RECEPCAO_ZN' THEN
    v_unit_code := 'zona_norte';
  ELSIF v_role IN ('ADMIN', 'DIRETOR', 'GERENTE') THEN
    v_unit_code := v_profile_unit;
  ELSE
    RAISE EXCEPTION 'Cargo sem permissão para exibir o QR de check-in.'
      USING ERRCODE = '42501';
  END IF;

  SELECT name, start_minutes, end_minutes
  INTO v_unit_name, v_start_minutes, v_end_minutes
  FROM public.checkin_units
  WHERE code = v_unit_code AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unidade de check-in indisponível.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.daily_qr_tokens_by_unit (token_date, unit_code)
  VALUES (v_today, v_unit_code)
  ON CONFLICT (token_date, unit_code) DO NOTHING;

  SELECT token INTO v_token
  FROM public.daily_qr_tokens_by_unit
  WHERE token_date = v_today AND unit_code = v_unit_code;

  RETURN jsonb_build_object(
    'token', v_token,
    'unit_code', v_unit_code,
    'unit_name', v_unit_name,
    'start_minutes', v_start_minutes,
    'end_minutes', v_end_minutes
  );
END;
$$;
```

- [ ] **Step 3: Criar a RPC restrita de validação**

Adicionar:

```sql
CREATE OR REPLACE FUNCTION public.validate_unit_daily_qr(
  p_token text,
  p_unit_code text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.daily_qr_tokens_by_unit
    WHERE token_date = (now() AT TIME ZONE 'America/Sao_Paulo')::date
      AND unit_code = p_unit_code
      AND token = p_token
  );
$$;

REVOKE ALL ON FUNCTION public.get_or_create_unit_daily_qr() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_unit_daily_qr(text, text) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_or_create_unit_daily_qr() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_unit_daily_qr(text, text) TO service_role;
```

- [ ] **Step 4: Fazer validação estática e commit**

Run:

```powershell
rg -n "daily_qr_tokens_by_unit|get_or_create_unit_daily_qr|validate_unit_daily_qr|RECEPCAO_ZN|America/Sao_Paulo|REVOKE ALL" supabase/migrations/20260828173000_checkin_unit_daily_qr.sql
git diff --check -- supabase/migrations/20260828173000_checkin_unit_daily_qr.sql
```

Expected: todos os elementos aparecem; `git diff --check` sem saída.

```powershell
git add supabase/migrations/20260828173000_checkin_unit_daily_qr.sql
git commit -m "feat(checkin): cria qr diario por unidade"
```

### Task 3: Novo cargo no Painel Admin

**Files:**
- Modify: `src/pages/admin/AdminPanel.tsx`

- [ ] **Step 1: Usar o catálogo compartilhado nos seletores**

Importar:

```ts
import {
  getReceptionUnitCode,
  getUserRoleLabel,
  USER_ROLE_OPTIONS,
} from '@/lib/auth/userRoles';
```

Substituir as duas listas literais de cargos por:

```tsx
{USER_ROLE_OPTIONS.map(option => (
  <option key={option.value} value={option.value}>{option.label}</option>
))}
```

Usar `getUserRoleLabel(u.role)` na legenda do card para que o valor técnico
`RECEPCAO_ZN` apareça como `RECEPÇÃO ZN`.

- [ ] **Step 2: Alinhar cargo e unidade em uma única atualização**

Substituir `handleRoleChange` por:

```ts
const handleRoleChange = async (id: string, role: string) => {
  try {
    const receptionUnit = getReceptionUnitCode(role);
    await updateProfile(id, {
      role,
      ...(receptionUnit ? { checkin_unit_code: receptionUnit } : {}),
    });
  } catch (error: any) {
    console.error('Erro ao atualizar perfil (role):', error);
    alert(`Não foi possível atualizar o cargo. ${error?.message || ''}`.trim());
  }
};
```

Isso deixa o seletor visível coerente com o cargo imediatamente após o refresh.

- [ ] **Step 3: Alinhar a unidade ao aprovar um perfil**

Em `handleConfirmApproval`, após montar `updateData`, acrescentar:

```ts
const receptionUnit = getReceptionUnitCode(approvalForm.role);
if (receptionUnit) {
  updateData.checkin_unit_code = receptionUnit;
}
```

Perfis de outros cargos continuam com a unidade padrão atual.

- [ ] **Step 4: Validar sintaxe e commit**

Run:

```powershell
deno test --no-config src/lib/auth/userRoles.test.ts
deno eval --no-config "import ts from 'npm:typescript@5.8.3'; const f='src/pages/admin/AdminPanel.tsx'; const s=await Deno.readTextFile(f); const r=ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,fileName:f}); if((r.diagnostics??[]).some(d=>d.category===ts.DiagnosticCategory.Error)) Deno.exit(1); console.log('AdminPanel syntax OK');"
```

Expected: teste PASS e `AdminPanel syntax OK`.

```powershell
git add src/pages/admin/AdminPanel.tsx
git commit -m "feat(admin): permite cadastrar recepcao zona norte"
```

### Task 4: Tela de QR vinculada à unidade

**Files:**
- Modify: `src/pages/CheckInDisplay.tsx`

- [ ] **Step 1: Modelar o retorno da RPC v2**

Adicionar o tipo e trocar os dados usados pela tela:

```ts
import { getCheckinWindowLabel, isCheckinOpen } from '@/lib/checkin/checkinUi';

interface UnitQrData {
  token: string;
  unit_code: string;
  unit_name: string;
  start_minutes: number;
  end_minutes: number;
}

const [qrData, setQrData] = useState<UnitQrData | null>(null);
```

Usar `const { isReception } = useAuthorization()` para o botão de saída.

- [ ] **Step 2: Trocar a geração global pela RPC por unidade**

No `loadToken`:

```ts
const { data, error: rpcError } = await supabase.rpc('get_or_create_unit_daily_qr');
const payload = data as UnitQrData | null;
if (
  rpcError
  || !payload?.token
  || !payload.unit_code
  || !payload.unit_name
  || !Number.isFinite(payload.start_minutes)
  || !Number.isFinite(payload.end_minutes)
) {
  throw new Error(rpcError?.message || 'Não foi possível carregar o QR da unidade.');
}

setQrData(payload);
setQrUrl(`${window.location.origin}/checkin?token=${payload.token}`);
```

O frontend não envia código de unidade à RPC.

- [ ] **Step 3: Tornar unidade e horário visíveis**

Calcular:

```ts
const startMinutes = qrData?.start_minutes ?? 480;
const endMinutes = qrData?.end_minutes ?? 810;
const windowLabel = getCheckinWindowLabel(startMinutes, endMinutes);
const nowMinutes = clock.h * 60 + clock.m;
const isOpen = isCheckinOpen(nowMinutes, startMinutes, endMinutes);
```

Alterar o título para:

```tsx
<h1 className="text-white text-xl font-bold">
  QR Code — {qrData?.unit_name ?? 'Carregando unidade'}
</h1>
```

Usar `windowLabel` no status aberto/fechado e no rodapé. Trocar
`role === 'RECEPCAO'` por `isReception` no botão de logout.

- [ ] **Step 4: Validar sintaxe e commit**

Run:

```powershell
deno eval --no-config "import ts from 'npm:typescript@5.8.3'; const f='src/pages/CheckInDisplay.tsx'; const s=await Deno.readTextFile(f); const r=ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,fileName:f}); if((r.diagnostics??[]).some(d=>d.category===ts.DiagnosticCategory.Error)) Deno.exit(1); console.log('CheckInDisplay syntax OK');"
```

Expected: `CheckInDisplay syntax OK`.

```powershell
git add src/pages/CheckInDisplay.tsx
git commit -m "feat(checkin): exibe qr e horario da unidade"
```

### Task 5: Validação unitária na Edge Function

**Files:**
- Modify: `supabase/functions/checkin-geo-v2/index.ts`

- [ ] **Step 1: Trocar somente a RPC de validação**

Substituir:

```ts
const { data: validQr, error: qrError } = await supabase.rpc(
  'validate_daily_qr',
  { p_token: normalizedQrToken },
);
```

por:

```ts
const { data: validQr, error: qrError } = await supabase.rpc(
  'validate_unit_daily_qr',
  {
    p_token: normalizedQrToken,
    p_unit_code: unit.code,
  },
);
```

`unit.code` já foi lido pelo cliente `service_role` a partir de
`profiles.checkin_unit_code`. Não adicionar unidade ao tipo do body.

- [ ] **Step 2: Ajustar a mensagem segura de rejeição**

Usar:

```ts
message: `QR Code inválido para a unidade ${unit.name} ou para a data atual.`,
```

Manter logs técnicos apenas no servidor e não retornar token, coordenadas da
unidade ou detalhes do banco.

- [ ] **Step 3: Rodar a verificação completa antes do commit**

Run:

```powershell
deno test --no-config src/lib/auth/userRoles.test.ts src/lib/checkin/checkinUi.test.ts supabase/functions/_shared/checkin-policy.test.ts supabase/functions/_shared/checkin-cors.test.ts
deno eval --no-config "import ts from 'npm:typescript@5.8.3'; for (const f of ['src/App.tsx','src/hooks/useAuthorization.ts','src/pages/admin/AdminPanel.tsx','src/pages/CheckInDisplay.tsx','src/pages/CheckIn.tsx']) { const s=await Deno.readTextFile(f); const r=ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,fileName:f}); if((r.diagnostics??[]).some(d=>d.category===ts.DiagnosticCategory.Error)) Deno.exit(1); } console.log('TS syntax OK');"
rg -n "validate_unit_daily_qr|p_unit_code: unit.code" supabase/functions/checkin-geo-v2/index.ts
rg -n "validate_daily_qr" supabase/functions/checkin-geo-v2/index.ts
git diff --check
```

Expected: testes PASS; `TS syntax OK`; a RPC v2 e `unit.code` aparecem; a busca
pela RPC global não retorna linhas na Edge v2; `git diff --check` sem erros.

- [ ] **Step 4: Commit**

```powershell
git add supabase/functions/checkin-geo-v2/index.ts
git commit -m "feat(checkin): valida qr da unidade atribuida"
```

### Task 6: Publicação segura e verificação do preview

**Files:**
- No source changes expected.

- [ ] **Step 1: Aplicar somente a migration nova**

Não usar `supabase db push`, pois o histórico remoto anterior está incompleto.
Com `SUPABASE_ACCESS_TOKEN` definido somente na sessão, aplicar o arquivo pela
Management API em uma transação:

```powershell
$headers = @{
  Authorization = "Bearer $env:SUPABASE_ACCESS_TOKEN"
  'Content-Type' = 'application/json; charset=utf-8'
}
$migration = Get-Content -Raw -Encoding UTF8 'supabase/migrations/20260828173000_checkin_unit_daily_qr.sql'
$query = "BEGIN;`n$migration`nCOMMIT;"
$json = @{ query = $query } | ConvertTo-Json -Compress
$body = [System.Text.Encoding]::UTF8.GetBytes($json)
Invoke-RestMethod -Method Post `
  -Uri 'https://api.supabase.com/v1/projects/pwvpxxrvlywlneuijmmd/database/query' `
  -Headers $headers `
  -Body $body
```

Expected: HTTP de sucesso, sem erro SQL.

- [ ] **Step 2: Registrar e verificar a migration**

```powershell
npx supabase migration repair 20260828173000 --status applied --linked
```

Depois consultar, sem retornar tokens:

```sql
SELECT
  to_regclass('public.daily_qr_tokens_by_unit') IS NOT NULL AS table_exists,
  to_regprocedure('public.get_or_create_unit_daily_qr()') IS NOT NULL AS generator_exists,
  to_regprocedure('public.validate_unit_daily_qr(text,text)') IS NOT NULL AS validator_exists;
```

Expected: os três valores `true`.

- [ ] **Step 3: Publicar a Edge v2 antes do frontend**

```powershell
npx supabase functions deploy checkin-geo-v2 --project-ref pwvpxxrvlywlneuijmmd
npx supabase functions list --project-ref pwvpxxrvlywlneuijmmd --output json
```

Expected: `checkin-geo-v2` com status `ACTIVE` e versão incrementada.

- [ ] **Step 4: Fazer push e aguardar o build do preview**

```powershell
git push origin preview/checkin-multiunidade
$deploymentUrl = npx vercel ls kaizen-axis1 --yes 2>&1 |
  Where-Object { $_ -match '^https://kaizen-axis1-[a-z0-9]+-hokma-tech\.vercel\.app$' } |
  Select-Object -First 1
if (-not $deploymentUrl) {
  throw 'Novo deployment de preview não encontrado na listagem da Vercel.'
}
npx vercel inspect $deploymentUrl --wait --timeout 90s --json
npx vercel inspect 'https://kaizen-axis1-git-preview-checkin-multiunidade-hokma-tech.vercel.app' --json
```

Expected: novo deployment `target: preview`, `readyState: READY`, e o alias
`kaizen-axis1-git-preview-checkin-multiunidade-hokma-tech.vercel.app` apontando
para ele. Não promover nem alterar alias de produção.

- [ ] **Step 5: Executar UAT com as contas dedicadas**

No preview:

1. ADMIN cria ou altera uma conta dedicada para `RECEPCAO`; confirmar unidade
   `Zona Oeste`, redirecionamento imediato e título `QR Code — Zona Oeste`.
2. ADMIN cria ou altera outra conta dedicada para `RECEPCAO_ZN`; confirmar
   unidade `Zona Norte`, redirecionamento imediato e título correspondente.
3. Comparar visualmente os dois QRs do mesmo dia e confirmar que são distintos.
4. Com um usuário de teste da Zona Oeste, confirmar que o QR Oeste chega à
   validação normal e que o QR Norte retorna inválido para Zona Oeste.
5. Repetir de forma inversa com usuário de teste da Zona Norte.
6. Confirmar que ADMIN, DIRETOR e GERENTE recebem o QR de
   `profiles.checkin_unit_code`.
7. Não usar a conta `RECEPCAO_ZN` no domínio de produção enquanto a branch não
   for promovida.

- [ ] **Step 6: Conferir Git e entregar**

```powershell
git rev-parse HEAD
git ls-remote origin refs/heads/preview/checkin-multiunidade
git status --short --branch
```

Expected: hashes local/remoto iguais; nenhum arquivo rastreado pendente; arquivos
não rastreados preexistentes permanecem intocados.
