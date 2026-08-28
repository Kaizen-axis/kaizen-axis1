# Check-in Multiunidade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vincular cada usuário a uma unidade de check-in, validar presença somente nessa unidade e permitir que ADMIN configure a janela global de horário.

**Architecture:** Uma migration aditiva cria as duas unidades, o vínculo protegido no perfil e o singleton de horário. O preview chama uma nova Edge Function `checkin-geo-v2`, que resolve a unidade pelo JWT/perfil no servidor e deixa a função de produção atual intacta. O `AppContext` fornece unidades e horário às telas administrativas e de check-in.

**Tech Stack:** React 19, TypeScript, Vite, Supabase/Postgres/RLS, Supabase Edge Functions (Deno), Node test runner com `tsx`, Vercel.

---

## Estrutura de arquivos

- Criar `supabase/migrations/20260828130000_checkin_multiunit_and_settings.sql`: schema, seeds, RLS, backfill e proteção do vínculo de unidade.
- Criar `supabase/functions/_shared/checkin-policy.ts`: regras puras de horário, precisão e Haversine usadas pela Edge.
- Criar `supabase/functions/_shared/checkin-policy.test.ts`: regressões de unidade, distância e horário.
- Criar `supabase/functions/checkin-geo-v2/index.ts`: autenticação, consultas e execução segura do check-in.
- Criar `src/lib/checkin/checkinUi.ts`: formatação e seleção de unidade para a interface.
- Criar `src/lib/checkin/checkinUi.test.ts`: regressões das regras de exibição.
- Modificar `src/context/AppContext.tsx`: tipos, estado, leitura e atualização do horário.
- Modificar `src/pages/admin/AdminPanel.tsx`: seletor por usuário e aba ADMIN de horário.
- Modificar `src/pages/CheckIn.tsx`: horário/unidade dinâmicos e chamada da Edge v2.

### Task 1: Regras puras de check-in

**Files:**
- Create: `supabase/functions/_shared/checkin-policy.test.ts`
- Create: `supabase/functions/_shared/checkin-policy.ts`
- Create: `src/lib/checkin/checkinUi.test.ts`
- Create: `src/lib/checkin/checkinUi.ts`

- [ ] **Step 1: Escrever testes que falham para a política executada no servidor**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCheckinPolicy, formatMinutes, haversineMeters } from './checkin-policy.ts';

const zonaNorte = {
  code: 'zona_norte', name: 'Zona Norte', latitude: -22.88719,
  longitude: -43.28214, max_radius_meters: 1000,
  max_accuracy_meters: 120, active: true,
};

describe('evaluateCheckinPolicy', () => {
  it('aceita o GPS dentro da unidade atribuída', () => {
    assert.equal(evaluateCheckinPolicy({ unit: zonaNorte, latitude: -22.88719,
      longitude: -43.28214, accuracy: 20, currentMinutes: 600,
      startMinutes: 480, endMinutes: 810 }).ok, true);
  });

  it('rejeita a localização de outra unidade', () => {
    const result = evaluateCheckinPolicy({ unit: zonaNorte, latitude: -22.903084,
      longitude: -43.561, accuracy: 20, currentMinutes: 600,
      startMinutes: 480, endMinutes: 810 });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'fora_do_raio');
  });

  it('rejeita GPS impreciso e horário fechado', () => {
    assert.equal(evaluateCheckinPolicy({ unit: zonaNorte, latitude: -22.88719,
      longitude: -43.28214, accuracy: 121, currentMinutes: 600,
      startMinutes: 480, endMinutes: 810 }).error, 'gps_impreciso');
    assert.equal(evaluateCheckinPolicy({ unit: zonaNorte, latitude: -22.88719,
      longitude: -43.28214, accuracy: 20, currentMinutes: 811,
      startMinutes: 480, endMinutes: 810 }).error, 'fora_do_horario');
  });
});

assert.equal(formatMinutes(810), '13:30');
assert.ok(haversineMeters(-22.88719, -43.28214, -22.903084, -43.561) > 1000);
```

- [ ] **Step 2: Executar o teste e confirmar a falha por módulo inexistente**

Run: `node --import tsx --test supabase/functions/_shared/checkin-policy.test.ts`

Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `checkin-policy.ts`.

- [ ] **Step 3: Implementar a política mínima**

```ts
export interface CheckinUnitPolicy {
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  max_radius_meters: number;
  max_accuracy_meters: number;
  active: boolean;
}

export function formatMinutes(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radius = 6_371_000;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(a));
}

export function evaluateCheckinPolicy(input: {
  unit: CheckinUnitPolicy; latitude: number; longitude: number; accuracy?: number;
  currentMinutes: number; startMinutes: number; endMinutes: number;
}): { ok: boolean; error?: 'gps_impreciso' | 'fora_do_horario' | 'fora_do_raio'; distance: number } {
  const distance = haversineMeters(input.latitude, input.longitude, input.unit.latitude, input.unit.longitude);
  if (typeof input.accuracy === 'number' && input.accuracy > input.unit.max_accuracy_meters) {
    return { ok: false, error: 'gps_impreciso', distance };
  }
  if (input.currentMinutes < input.startMinutes || input.currentMinutes > input.endMinutes) {
    return { ok: false, error: 'fora_do_horario', distance };
  }
  if (distance > input.unit.max_radius_meters) return { ok: false, error: 'fora_do_raio', distance };
  return { ok: true, distance };
}
```

- [ ] **Step 4: Escrever os testes de UI antes do helper**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAssignedUnit, getCheckinWindowLabel, isCheckinOpen } from './checkinUi.ts';

describe('checkin UI helpers', () => {
  it('formata e aplica a janela configurada', () => {
    assert.equal(getCheckinWindowLabel(480, 810), '08:00 – 13:30');
    assert.equal(isCheckinOpen(480, 480, 810), true);
    assert.equal(isCheckinOpen(811, 480, 810), false);
  });

  it('resolve somente a unidade atribuída', () => {
    const units = [{ code: 'zona_oeste', name: 'Zona Oeste' }, { code: 'zona_norte', name: 'Zona Norte' }];
    assert.equal(getAssignedUnit('zona_norte', units)?.name, 'Zona Norte');
    assert.equal(getAssignedUnit('outra', units), null);
  });
});
```

- [ ] **Step 5: Executar o teste de UI e confirmar a falha esperada**

Run: `node --import tsx --test src/lib/checkin/checkinUi.test.ts`

Expected: FAIL com `ERR_MODULE_NOT_FOUND` para `checkinUi.ts`.

- [ ] **Step 6: Implementar e validar os helpers de UI**

```ts
export function minutesToHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
export function hhmmToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}
export function getCheckinWindowLabel(start: number, end: number): string {
  return `${minutesToHHMM(start)} – ${minutesToHHMM(end)}`;
}
export function isCheckinOpen(now: number, start: number, end: number): boolean {
  return now >= start && now <= end;
}
export function getAssignedUnit<T extends { code: string }>(code: string | null | undefined, units: T[]): T | null {
  return units.find((unit) => unit.code === code) ?? null;
}
```

Run: `node --import tsx --test supabase/functions/_shared/checkin-policy.test.ts src/lib/checkin/checkinUi.test.ts`

Expected: PASS, 0 falhas.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/_shared/checkin-policy.ts supabase/functions/_shared/checkin-policy.test.ts src/lib/checkin/checkinUi.ts src/lib/checkin/checkinUi.test.ts
git commit -m "test(checkin): cobre regras de unidade distancia e horario"
```

### Task 2: Schema, seeds e segurança no Supabase

**Files:**
- Create: `supabase/migrations/20260828130000_checkin_multiunit_and_settings.sql`

- [ ] **Step 1: Criar migration aditiva e idempotente**

O SQL deve, nesta ordem:

```sql
create table if not exists public.checkin_units (
  code text primary key,
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  max_radius_meters integer not null check (max_radius_meters between 50 and 50000),
  max_accuracy_meters integer not null check (max_accuracy_meters between 10 and 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.checkin_units
  (code, name, latitude, longitude, max_radius_meters, max_accuracy_meters, active)
values
  ('zona_oeste', 'Zona Oeste', -22.903084, -43.561000, 1000, 120, true),
  ('zona_norte', 'Zona Norte', -22.887190, -43.282140, 1000, 120, true)
on conflict (code) do update set
  name = excluded.name, latitude = excluded.latitude, longitude = excluded.longitude,
  max_radius_meters = excluded.max_radius_meters,
  max_accuracy_meters = excluded.max_accuracy_meters,
  active = excluded.active, updated_at = now();

alter table public.profiles add column if not exists checkin_unit_code text;
update public.profiles set checkin_unit_code = 'zona_oeste' where checkin_unit_code is null;
alter table public.profiles alter column checkin_unit_code set default 'zona_oeste';
alter table public.profiles alter column checkin_unit_code set not null;
alter table public.profiles drop constraint if exists profiles_checkin_unit_code_fkey;
alter table public.profiles add constraint profiles_checkin_unit_code_fkey
  foreign key (checkin_unit_code) references public.checkin_units(code);

create table if not exists public.checkin_settings (
  id smallint primary key default 1 check (id = 1),
  start_minutes smallint not null default 480,
  end_minutes smallint not null default 810,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.checkin_settings add column if not exists start_minutes smallint not null default 480;
alter table public.checkin_settings add column if not exists end_minutes smallint not null default 810;
insert into public.checkin_settings (id) values (1) on conflict (id) do nothing;
```

Completar a mesma migration com constraints de horário, RLS e policies ADMIN;
criar `public.protect_profile_checkin_unit()` e trigger `BEFORE UPDATE OF
checkin_unit_code` que permite a mudança somente quando
`public.app_current_user_role() = 'ADMIN'` ou `auth.role() = 'service_role'`.
Conceder `SELECT` às roles autenticadas e escrita protegida por RLS.

- [ ] **Step 2: Validar estaticamente a migration**

Run:

```powershell
rg -n "zona_oeste|zona_norte|checkin_unit_code|checkin_settings|protect_profile_checkin_unit|enable row level security" supabase/migrations/20260828130000_checkin_multiunit_and_settings.sql
git diff --check -- supabase/migrations/20260828130000_checkin_multiunit_and_settings.sql
```

Expected: todos os elementos aparecem e `git diff --check` não relata erros.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260828130000_checkin_multiunit_and_settings.sql
git commit -m "feat(checkin): cria unidades configuracao e vinculo protegido"
```

### Task 3: Edge Function isolada para o preview

**Files:**
- Create: `supabase/functions/checkin-geo-v2/index.ts`
- Modify: `supabase/functions/_shared/checkin-policy.test.ts`

- [ ] **Step 1: Acrescentar teste que prova que a unidade vem do contexto resolvido**

Adicionar um caso em que o objeto de localização contém um campo extra
`unitCode: 'zona_oeste'`, mas `evaluateCheckinPolicy` recebe `unit: zonaNorte` e
continua rejeitando as coordenadas da Zona Oeste. O campo extra nunca deve fazer
parte da assinatura da política.

- [ ] **Step 2: Executar o teste e confirmar o comportamento protegido**

Run: `node --import tsx --test supabase/functions/_shared/checkin-policy.test.ts`

Expected: PASS; TypeScript/política não usam `unitCode` enviado pelo cliente.

- [ ] **Step 3: Criar `checkin-geo-v2` a partir da função atual**

Copiar os controles existentes de JWT, rate limit, validação do QR e chamada de
`fazer_checkin`, mas substituir constantes de escritório por:

```ts
const { data: profileRow, error: profileError } = await supabase
  .from('profiles')
  .select('checkin_unit_code')
  .eq('id', userId)
  .single();
if (profileError || !profileRow?.checkin_unit_code) {
  return json({ error: 'unidade_nao_configurada', message: 'Sua unidade de check-in não está configurada. Fale com o administrador.' }, 403);
}

const { data: unit, error: unitError } = await supabase
  .from('checkin_units')
  .select('code, name, latitude, longitude, max_radius_meters, max_accuracy_meters, active')
  .eq('code', profileRow.checkin_unit_code)
  .eq('active', true)
  .maybeSingle();
if (unitError || !unit) {
  return json({ error: 'unidade_indisponivel', message: 'A unidade vinculada está indisponível. Fale com o administrador.' }, 403);
}
```

Ler `checkin_settings` com fallback 480/810, chamar `evaluateCheckinPolicy` com
a unidade carregada e retornar erros com o nome da unidade. O body aceito deve
permanecer apenas `{ latitude, longitude, accuracy, qrToken }`.

Validar CORS para os domínios oficiais e para previews do projeto
`kaizen-axis1-*.vercel.app`, ecoando somente origens aprovadas.

- [ ] **Step 4: Validar política e checagem TypeScript do projeto**

Run:

```powershell
node --import tsx --test supabase/functions/_shared/checkin-policy.test.ts
npm run lint
```

Expected: política PASS; `npm run lint` sem novos erros atribuíveis aos arquivos
criados (erros preexistentes, se houver, devem ser registrados sem mascará-los).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/checkin-geo-v2/index.ts supabase/functions/_shared/checkin-policy.test.ts
git commit -m "feat(checkin): adiciona edge v2 por unidade atribuida"
```

### Task 4: Estado compartilhado e interface ADMIN

**Files:**
- Modify: `src/context/AppContext.tsx`
- Modify: `src/pages/admin/AdminPanel.tsx`

- [ ] **Step 1: Estender os tipos e estado do `AppContext`**

Adicionar:

```ts
export interface CheckinUnit {
  code: string; name: string; latitude: number; longitude: number;
  max_radius_meters: number; max_accuracy_meters: number; active: boolean;
}
export interface CheckinSettings {
  id: number; start_minutes: number; end_minutes: number;
  updated_at?: string; updated_by?: string | null;
}
```

Adicionar `checkin_unit_code?: string` a `Profile` e expor no contexto:

```ts
checkinUnits: CheckinUnit[];
checkinSettings: CheckinSettings | null;
refreshCheckinConfig: () => Promise<void>;
updateCheckinSettings: (startMinutes: number, endMinutes: number) => Promise<void>;
```

`refreshCheckinConfig` deve buscar unidades ativas e `checkin_settings.id = 1` em
paralelo. `updateCheckinSettings` deve atualizar `start_minutes`, `end_minutes`,
`updated_at` e `updated_by`, depois recarregar a configuração. Incluir o refresh
no carregamento autenticado já existente.

- [ ] **Step 2: Adicionar o seletor de unidade ao card de usuário**

Criar `handleCheckinUnitChange(id, code)` que chama
`updateProfile(id, { checkin_unit_code: code })`, exibe erro e recarrega os
perfis. Dentro de `activeUsers.map`, renderizar somente para `isAdmin`:

```tsx
<select
  value={u.checkin_unit_code ?? 'zona_oeste'}
  onChange={(event) => handleCheckinUnitChange(u.id, event.target.value)}
  aria-label={`Unidade de check-in de ${u.name}`}
  className="w-full md:w-40 min-h-11 text-xs bg-surface-50 border border-surface-200 rounded-lg px-2 py-2"
>
  {checkinUnits.map((unit) => <option key={unit.code} value={unit.code}>{unit.name}</option>)}
</select>
```

- [ ] **Step 3: Adicionar a aba ADMIN `Check-in`**

Acrescentar `checkin` ao tipo `Tab`, incluir `{ id: 'checkin', label: 'Check-in',
icon: Clock, adminOnly: true }` na barra e um `case 'checkin'` no conteúdo.

O formulário usa `minutesToHHMM`/`hhmmToMinutes`, exige fim maior que início,
lista as duas unidades como resumo somente leitura e chama
`updateCheckinSettings(start, end)`. O botão fica desabilitado durante o save e
exibe feedback explícito.

- [ ] **Step 4: Rodar testes de helpers e compilação**

Run:

```powershell
node --import tsx --test src/lib/checkin/checkinUi.test.ts
npm run build
```

Expected: testes PASS e build com exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/context/AppContext.tsx src/pages/admin/AdminPanel.tsx
git commit -m "feat(admin): permite definir unidade e horario de check-in"
```

### Task 5: Tela de check-in e integração do preview

**Files:**
- Modify: `src/pages/CheckIn.tsx`

- [ ] **Step 1: Consumir unidade e horário compartilhados**

Trocar os valores fixos por:

```ts
const startMinutes = checkinSettings?.start_minutes ?? 480;
const endMinutes = checkinSettings?.end_minutes ?? 810;
const windowLabel = getCheckinWindowLabel(startMinutes, endMinutes);
const isOpen = isCheckinOpen(brtMinutes, startMinutes, endMinutes);
const assignedUnit = getAssignedUnit(profile?.checkin_unit_code, checkinUnits);
```

Substituir todos os textos `08:00–13:30` por `windowLabel` e mostrar
`assignedUnit?.name ?? 'Unidade não configurada'` no resumo da tela.

- [ ] **Step 2: Apontar somente esta branch para a Edge v2**

Alterar:

```ts
supabase.functions.invoke('checkin-geo-v2', {
  body: { latitude, longitude, accuracy, qrToken },
});
```

Não adicionar `unit`, `unitCode` ou coordenadas da unidade ao body.

- [ ] **Step 3: Executar verificações focadas e build completo**

Run:

```powershell
node --import tsx --test supabase/functions/_shared/checkin-policy.test.ts src/lib/checkin/checkinUi.test.ts
npm run build
git diff --check
```

Expected: todos os testes PASS, build exit 0 e nenhum erro em `git diff --check`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/CheckIn.tsx
git commit -m "feat(checkin): exibe unidade e usa validacao v2 no preview"
```

### Task 6: Publicação e verificação do preview

**Files:**
- No source changes expected.

- [ ] **Step 1: Aplicar backend com a credencial vinculada**

Run:

```powershell
npx supabase db push --linked
npx supabase functions deploy checkin-geo-v2
```

Expected: migration aplicada e função com status de deploy concluído. Se a conta
retornar `403`, parar apenas esta etapa e registrar que uma conta proprietária
precisa executar exatamente os dois comandos.

- [ ] **Step 2: Verificação final fresca antes do push**

Run:

```powershell
node --import tsx --test supabase/functions/_shared/checkin-policy.test.ts src/lib/checkin/checkinUi.test.ts
npm run build
git status --short --branch
```

Expected: testes PASS, build exit 0 e apenas arquivos não relacionados já
existentes permanecem fora dos commits.

- [ ] **Step 3: Publicar a branch e aguardar a Vercel**

Run:

```powershell
git push -u origin preview/checkin-multiunidade
npx vercel ls --yes
```

Expected: branch remota criada e deployment Preview com status `Ready`.

- [ ] **Step 4: Inspecionar o deployment e entregar o link**

Usar `npx vercel inspect <url-do-preview>` e confirmar `target = preview`, branch
`preview/checkin-multiunidade` e status `Ready`. Não promover nem alterar aliases
de produção.
