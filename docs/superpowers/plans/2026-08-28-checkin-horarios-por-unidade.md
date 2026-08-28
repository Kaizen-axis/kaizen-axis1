# Horários de Check-in por Unidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compactar os seletores dos cards de usuário e permitir que ADMIN configure, com feedback visual, uma janela de check-in diferente para cada unidade.

**Architecture:** A própria linha de `checkin_units` passa a armazenar `start_minutes` e `end_minutes`. A Edge Function resolve a unidade pelo perfil e aplica a janela contida nessa unidade; o frontend lê a mesma fonte. A tabela singleton `checkin_settings` permanece intacta apenas para compatibilidade com a versão antiga em produção.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vite, Supabase/Postgres/RLS, Supabase Edge Functions (Deno), Deno test runner, Vercel.

---

## Estrutura de arquivos

- Criar `supabase/migrations/20260828164000_checkin_unit_schedules.sql`: adiciona e restringe a janela de cada unidade.
- Modificar `supabase/functions/_shared/checkin-policy.ts`: torna o horário parte da política da unidade.
- Modificar `supabase/functions/_shared/checkin-policy.test.ts`: prova que unidades podem rejeitar horários diferentes.
- Modificar `supabase/functions/checkin-geo-v2/index.ts`: lê e aplica a janela da unidade atribuída.
- Modificar `src/context/AppContext.tsx`: lê e atualiza o horário de uma unidade.
- Modificar `src/pages/admin/AdminPanel.tsx`: compacta os seletores e cria formulário/feedback individual por unidade.
- Modificar `src/pages/CheckIn.tsx`: exibe e avalia a janela da unidade atribuída.

### Task 1: Política de horário pertencente à unidade

**Files:**
- Modify: `supabase/functions/_shared/checkin-policy.test.ts`
- Modify: `supabase/functions/_shared/checkin-policy.ts`

- [ ] **Step 1: Escrever o teste que falha para janelas diferentes**

Adicionar duas unidades com janelas distintas e avaliar o mesmo minuto:

```ts
it('uses the schedule of the assigned unit', () => {
  const west = { ...zonaOeste, start_minutes: 480, end_minutes: 540 };
  const north = { ...zonaNorte, start_minutes: 560, end_minutes: 720 };

  const westResult = evaluateCheckinPolicy({
    unit: west,
    latitude: west.latitude,
    longitude: west.longitude,
    accuracy: 20,
    currentMinutes: 570,
  } as never);
  const northResult = evaluateCheckinPolicy({
    unit: north,
    latitude: north.latitude,
    longitude: north.longitude,
    accuracy: 20,
    currentMinutes: 570,
  } as never);

  assert.equal(westResult.error, 'fora_do_horario');
  assert.equal(northResult.ok, true);
});
```

No mesmo minuto, a Zona Oeste deve rejeitar e a Zona Norte deve aceitar. O cast
existe somente no teste RED, até a assinatura nova ser implementada.

- [ ] **Step 2: Executar e observar a falha correta**

Run:

```powershell
deno test --no-config supabase/functions/_shared/checkin-policy.test.ts
```

Expected: FAIL porque a implementação atual depende de `startMinutes` e
`endMinutes` externos e não usa a janela contida na unidade.

- [ ] **Step 3: Implementar a assinatura mínima**

Adicionar ao `CheckinUnitPolicy`:

```ts
start_minutes: number;
end_minutes: number;
```

Remover `startMinutes` e `endMinutes` do input de `evaluateCheckinPolicy` e usar:

```ts
if (
  input.currentMinutes < input.unit.start_minutes
  || input.currentMinutes > input.unit.end_minutes
) {
  return { ok: false, error: 'fora_do_horario', distance };
}
```

Atualizar os fixtures e chamadas existentes para incluir 480/810 na unidade.

- [ ] **Step 4: Confirmar GREEN e commit**

Run:

```powershell
deno test --no-config supabase/functions/_shared/checkin-policy.test.ts
```

Expected: todos os testes PASS, 0 falhas.

```powershell
git add supabase/functions/_shared/checkin-policy.ts supabase/functions/_shared/checkin-policy.test.ts
git commit -m "test(checkin): vincula horario a unidade atribuida"
```

### Task 2: Persistência dos horários por unidade

**Files:**
- Create: `supabase/migrations/20260828164000_checkin_unit_schedules.sql`

- [ ] **Step 1: Criar a migration aditiva**

```sql
ALTER TABLE public.checkin_units
  ADD COLUMN IF NOT EXISTS start_minutes smallint NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS end_minutes smallint NOT NULL DEFAULT 810;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkin_units_start_minutes_range'
      AND conrelid = 'public.checkin_units'::regclass
  ) THEN
    ALTER TABLE public.checkin_units
      ADD CONSTRAINT checkin_units_start_minutes_range
      CHECK (start_minutes >= 0 AND start_minutes < 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkin_units_end_minutes_range'
      AND conrelid = 'public.checkin_units'::regclass
  ) THEN
    ALTER TABLE public.checkin_units
      ADD CONSTRAINT checkin_units_end_minutes_range
      CHECK (end_minutes > 0 AND end_minutes < 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'checkin_units_window_order'
      AND conrelid = 'public.checkin_units'::regclass
  ) THEN
    ALTER TABLE public.checkin_units
      ADD CONSTRAINT checkin_units_window_order
      CHECK (end_minutes > start_minutes);
  END IF;
END
$$;
```

Os defaults atribuem 08:00–13:30 às duas linhas existentes sem alterar
coordenadas, raio ou precisão.

- [ ] **Step 2: Validar e commit**

Run:

```powershell
rg -n "start_minutes|end_minutes|window_order" supabase/migrations/20260828164000_checkin_unit_schedules.sql
git diff --check -- supabase/migrations/20260828164000_checkin_unit_schedules.sql
```

Expected: os campos e três constraints aparecem; `git diff --check` sem saída.

```powershell
git add supabase/migrations/20260828164000_checkin_unit_schedules.sql
git commit -m "feat(checkin): persiste horario por unidade"
```

### Task 3: Contexto e interface administrativa

**Files:**
- Modify: `src/context/AppContext.tsx`
- Modify: `src/pages/admin/AdminPanel.tsx`

- [ ] **Step 1: Trocar o estado global pelo horário da unidade**

Adicionar a `CheckinUnit`:

```ts
start_minutes: number;
end_minutes: number;
```

Remover `CheckinSettings`, `checkinSettings` e `updateCheckinSettings` do estado
e do contrato. Expor:

```ts
updateCheckinUnitSchedule: (
  unitCode: string,
  startMinutes: number,
  endMinutes: number,
) => Promise<void>;
```

`refreshCheckinConfig` seleciona também `start_minutes, end_minutes`. A escrita
usa a policy ADMIN já existente:

```ts
const updateCheckinUnitSchedule = useCallback(async (
  unitCode: string,
  startMinutes: number,
  endMinutes: number,
) => {
  const { error } = await supabase
    .from('checkin_units')
    .update({
      start_minutes: startMinutes,
      end_minutes: endMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq('code', unitCode);

  if (error) throw error;
  await refreshCheckinConfig();
}, [refreshCheckinConfig]);
```

- [ ] **Step 2: Criar formulário e feedback individual por unidade**

No `AdminPanel`, manter drafts por código, o código em salvamento e feedback por
unidade:

```ts
type UnitScheduleFeedback = { type: 'success' | 'error'; message: string };

const [unitScheduleForms, setUnitScheduleForms] = useState<Record<string, { start: string; end: string }>>({});
const [savingUnitCode, setSavingUnitCode] = useState<string | null>(null);
const [unitScheduleFeedback, setUnitScheduleFeedback] = useState<Record<string, UnitScheduleFeedback>>({});
```

Sincronizar drafts a partir de `checkinUnits`. Ao salvar, validar números e
`end > start`, limpar o feedback anterior, mostrar `Salvando...`, chamar
`updateCheckinUnitSchedule` e então gravar um dos retornos visuais:

```ts
{ type: 'success', message: `Horário de ${unit.name} salvo com sucesso.` }
{ type: 'error', message: 'Não foi possível salvar. Tente novamente.' }
```

O feedback deve usar `role="status"` e cores verde/vermelho; cada botão afeta
somente seu bloco e fica desabilitado apenas enquanto aquela unidade é salva.

- [ ] **Step 3: Renderizar um card por unidade**

Substituir o formulário global por `checkinUnits.map(unit => ...)`. Cada card
contém nome, tolerâncias, inputs `type="time"`, botão `Salvar horário` e a
mensagem de retorno daquela unidade. A aba e sua posição não mudam.

- [ ] **Step 4: Compactar os seis seletores dos cards**

Trocar o agrupador dos dropdowns ativos por:

```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2 items-center">
```

Todos os seis `select` devem usar a mesma classe:

```tsx
className="w-full min-w-0 h-9 text-[11px] bg-surface-50 border border-surface-200 rounded-lg px-2 py-1 focus:outline-none focus:border-gold-400"
```

Assim ficam em uma linha no desktop e continuam legíveis/responsivos em telas
estreitas.

- [ ] **Step 5: Verificar sintaxe e commit**

Run:

```powershell
deno eval --no-config "import ts from 'npm:typescript'; for (const f of ['src/context/AppContext.tsx','src/pages/admin/AdminPanel.tsx']) { const s=await Deno.readTextFile(f); const r=ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,fileName:f}); if(r.diagnostics?.length) throw new Error(f); } console.log('TSX syntax OK');"
```

Expected: `TSX syntax OK`.

```powershell
git add src/context/AppContext.tsx src/pages/admin/AdminPanel.tsx
git commit -m "feat(admin): configura horario por unidade"
```

### Task 4: Edge, tela e publicação do preview

**Files:**
- Modify: `supabase/functions/checkin-geo-v2/index.ts`
- Modify: `src/pages/CheckIn.tsx`

- [ ] **Step 1: Aplicar a janela da unidade na Edge Function**

Selecionar `start_minutes, end_minutes` junto dos demais campos de
`checkin_units`. Remover a consulta a `checkin_settings`, chamar
`evaluateCheckinPolicy` sem parâmetros globais e construir a mensagem de erro
com `unit.start_minutes` e `unit.end_minutes`.

- [ ] **Step 2: Exibir a janela da unidade atribuída**

Em `CheckIn.tsx`, remover `checkinSettings` do contexto e calcular:

```ts
const assignedUnit = getAssignedUnit(profile?.checkin_unit_code, checkinUnits);
const startMinutes = assignedUnit?.start_minutes ?? 480;
const endMinutes = assignedUnit?.end_minutes ?? 810;
const windowLabel = getCheckinWindowLabel(startMinutes, endMinutes);
const isOpen = isCheckinOpen(brtMinutes, startMinutes, endMinutes);
```

Nenhum código de unidade ou horário é enviado pelo navegador à Edge Function.

- [ ] **Step 3: Rodar verificação completa focada**

Run:

```powershell
deno test --no-config src/lib/checkin/checkinUi.test.ts supabase/functions/_shared/checkin-policy.test.ts supabase/functions/_shared/checkin-cors.test.ts
deno eval --no-config "import ts from 'npm:typescript'; for (const f of ['src/context/AppContext.tsx','src/pages/admin/AdminPanel.tsx','src/pages/CheckIn.tsx']) { const s=await Deno.readTextFile(f); const r=ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,fileName:f}); if(r.diagnostics?.length) throw new Error(f); } console.log('TSX syntax OK');"
git diff --check
```

Expected: testes PASS, `TSX syntax OK` e `git diff --check` sem erros.

- [ ] **Step 4: Commit, aplicar Supabase e publicar**

```powershell
git add supabase/functions/checkin-geo-v2/index.ts src/pages/CheckIn.tsx
git commit -m "feat(checkin): aplica horario da unidade atribuida"
```

Como o histórico remoto anterior está incompleto, aplicar somente
`20260828164000_checkin_unit_schedules.sql` pela Management API em transação e
marcar apenas `20260828164000` como aplicada. Depois:

```powershell
npx supabase functions deploy checkin-geo-v2 --project-ref pwvpxxrvlywlneuijmmd
git push origin preview/checkin-multiunidade
npx vercel inspect https://kaizen-axis1-git-preview-checkin-multiunidade-hokma-tech.vercel.app --json
```

Expected: migration verificada no banco, função `ACTIVE`, branch remota no HEAD
local e deployment Vercel `target: preview`, `readyState: READY`.
