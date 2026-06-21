# Configuração de Check-in no Painel Admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar os parâmetros de check-in (janela de horário, localização do escritório, raio e precisão do GPS) editáveis por ADMIN numa sub-aba do Painel Administrativo, lidos de uma única fonte de verdade no banco.

**Architecture:** Tabela singleton `checkin_settings` é a fonte de verdade. A edge function `checkin-geo` lê essa linha a cada check-in (com fallback aos defaults atuais). O app lê via `AppContext` para exibir o horário (`CheckIn.tsx`) e para editar (nova aba no `AdminPanel`).

**Tech Stack:** Supabase (Postgres + RLS + Edge Functions/Deno), React + TypeScript, Vite, Tailwind. Spec: `docs/superpowers/specs/2026-06-21-checkin-settings-design.md`.

**Branch:** `preview/checkin-settings` (já criada, base `preview/v3`). Não tocar `main`.

**Nota sobre testes:** este projeto não possui suíte de testes unitários; o gate de verificação é `npm run build` (o `lint`/`tsc` tem erros pré-existentes e estouro de heap — não usar como gate). A validação funcional final é um checklist de UAT manual na Task 7. Migration e deploy só são aplicados após a validação no preview.

---

## File Structure

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20260621120000_create_checkin_settings.sql` | Criar | Tabela `checkin_settings` + constraints + RLS + seed |
| `supabase/functions/checkin-geo/index.ts` | Modificar | Ler config do banco com fallback; usar nos checks de horário/raio/precisão |
| `src/context/AppContext.tsx` | Modificar | Tipo `CheckinSettings`, estado, `refreshCheckinSettings`, `updateCheckinSettings`, init + value |
| `src/pages/admin/AdminPanel.tsx` | Modificar | Nova aba `'checkin'` (só ADMIN) + formulário de edição |
| `src/pages/CheckIn.tsx` | Modificar | Ler horário das settings para `isOpen` e textos exibidos |

---

## Task 1: Migration — tabela `checkin_settings`

**Files:**
- Create: `supabase/migrations/20260621120000_create_checkin_settings.sql`

- [ ] **Step 1: Criar o arquivo de migration**

Crie `supabase/migrations/20260621120000_create_checkin_settings.sql` com o conteúdo exato:

```sql
-- Fonte de verdade única para os parâmetros de check-in, hoje hardcoded/env na
-- edge function checkin-geo. Linha única (singleton) editável pelo ADMIN.
create table if not exists public.checkin_settings (
  id                   smallint primary key default 1 check (id = 1),
  start_minutes        smallint not null default 480  check (start_minutes >= 0 and start_minutes < 1440),
  end_minutes          smallint not null default 810  check (end_minutes > 0 and end_minutes < 1440),
  office_latitude      double precision not null default -23.5505 check (office_latitude between -90 and 90),
  office_longitude     double precision not null default -46.6333 check (office_longitude between -180 and 180),
  max_radius_meters    integer not null default 1000  check (max_radius_meters between 50 and 50000),
  max_accuracy_meters  integer not null default 120   check (max_accuracy_meters between 10 and 1000),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references public.profiles(id) on delete set null,
  constraint checkin_settings_window check (end_minutes > start_minutes)
);

-- Semeia exatamente os valores de produção atuais (08:00-13:30, SP, 1000m, 120m).
insert into public.checkin_settings (id) values (1)
on conflict (id) do nothing;

alter table public.checkin_settings enable row level security;

-- Leitura: qualquer autenticado (o app precisa exibir o horário).
drop policy if exists "checkin_settings_select_authenticated" on public.checkin_settings;
create policy "checkin_settings_select_authenticated"
on public.checkin_settings
for select
to authenticated
using (true);

-- Escrita (insert/update): apenas ADMIN.
drop policy if exists "checkin_settings_insert_admin" on public.checkin_settings;
create policy "checkin_settings_insert_admin"
on public.checkin_settings
for insert
to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and upper(coalesce(p.role, '')) = 'ADMIN'
  )
);

drop policy if exists "checkin_settings_update_admin" on public.checkin_settings;
create policy "checkin_settings_update_admin"
on public.checkin_settings
for update
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and upper(coalesce(p.role, '')) = 'ADMIN'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and upper(coalesce(p.role, '')) = 'ADMIN'
  )
);
```

- [ ] **Step 2: Revisar o SQL**

Confira: `id` singleton (`check (id = 1)`), defaults batem com produção (480=08:00, 810=13:30), todas as constraints presentes, RLS habilitada, 3 policies (select authenticated, insert admin, update admin). Não aplicar no banco ainda (será na Task 7 / UAT no preview).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260621120000_create_checkin_settings.sql
git commit -m "feat(checkin): migration da tabela checkin_settings (singleton + RLS + seed)"
```

---

## Task 2: Edge function lê a config com fallback

**Files:**
- Modify: `supabase/functions/checkin-geo/index.ts`

- [ ] **Step 1: Adicionar o carregamento da config após criar o service client**

Em `supabase/functions/checkin-geo/index.ts`, logo após o bloco que cria o client `supabase` com service role (atual linha ~83-87, o `const supabase = createClient(... SERVICE_ROLE_KEY ...)`), insira:

```ts
  // ── Config de check-in (fonte de verdade no banco; fallback aos defaults) ──
  const cfg = {
    startMinutes: 8 * 60,            // 08:00
    endMinutes:   13 * 60 + 30,      // 13:30
    officeLat:    OFFICE_LAT,
    officeLng:    OFFICE_LNG,
    maxRadius:    MAX_RADIUS,
    maxAccuracy:  MAX_ACCURACY,
  };
  try {
    const { data: settings } = await supabase
      .from('checkin_settings')
      .select('start_minutes, end_minutes, office_latitude, office_longitude, max_radius_meters, max_accuracy_meters')
      .eq('id', 1)
      .maybeSingle();
    if (settings) {
      cfg.startMinutes = settings.start_minutes ?? cfg.startMinutes;
      cfg.endMinutes   = settings.end_minutes ?? cfg.endMinutes;
      cfg.officeLat    = settings.office_latitude ?? cfg.officeLat;
      cfg.officeLng    = settings.office_longitude ?? cfg.officeLng;
      cfg.maxRadius    = settings.max_radius_meters ?? cfg.maxRadius;
      cfg.maxAccuracy  = settings.max_accuracy_meters ?? cfg.maxAccuracy;
    }
  } catch (e) {
    console.warn('[checkin-geo] falha ao ler checkin_settings, usando defaults:', (e as any)?.message);
  }

  // Formata minutos (desde 00:00 BRT) em HH:MM para mensagens.
  const fmtHHMM = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
```

- [ ] **Step 2: Usar `cfg.maxAccuracy` na validação de precisão do GPS**

Localize o bloco "4. Validar precisão do GPS" (atual linha ~124) e substitua a condição e a mensagem:

```ts
  // ── 4. Validar precisão do GPS ────────────────────────────────────────────
  if (typeof accuracy === 'number' && accuracy > cfg.maxAccuracy) {
    return json({
      error:    'gps_impreciso',
      message:  `GPS impreciso (±${Math.round(accuracy)}m). Vá para um local aberto e tente novamente.`,
      accuracy: Math.round(accuracy),
    }, 403);
  }
```

- [ ] **Step 3: Usar `cfg.startMinutes`/`cfg.endMinutes` na janela de horário**

Localize o bloco "6. Janela de horário" (atual linha ~154-158) e substitua por:

```ts
  // ── 6. Janela de horário (configurável via checkin_settings) ─────────────
  const brtMinutes = getBRTMinutes();
  if (brtMinutes < cfg.startMinutes || brtMinutes > cfg.endMinutes) {
    return json({
      error: 'fora_do_horario',
      message: `Check-in permitido apenas entre ${fmtHHMM(cfg.startMinutes)} e ${fmtHHMM(cfg.endMinutes)}.`,
      brt_minutes: brtMinutes,
    }, 403);
  }
```

- [ ] **Step 4: Usar `cfg.officeLat`/`cfg.officeLng`/`cfg.maxRadius` na geolocalização**

Localize o bloco "7. Geolocalização (Haversine)" (atual linha ~161-168) e substitua por:

```ts
  // ── 7. Geolocalização (Haversine) ─────────────────────────────────────────
  const distance = haversineMeters(latitude, longitude, cfg.officeLat, cfg.officeLng);
  if (distance > cfg.maxRadius) {
    return json({
      error:    'fora_do_raio',
      message:  `Você está a ${Math.round(distance)}m da imobiliária. Máximo permitido: ${cfg.maxRadius}m.`,
      distance: Math.round(distance),
    }, 403);
  }
```

- [ ] **Step 5: Revisar**

Confira que as constantes `OFFICE_LAT`, `OFFICE_LNG`, `MAX_RADIUS`, `MAX_ACCURACY` continuam definidas no topo (são o fallback dentro de `cfg`) e que nenhum outro ponto do arquivo ainda usa `MAX_RADIUS`/`MAX_ACCURACY` diretamente nos checks (apenas dentro do objeto `cfg`). O `getBRTMinutes()` continua sendo a fonte da hora.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/checkin-geo/index.ts
git commit -m "feat(checkin): edge function le parametros de checkin_settings com fallback"
```

---

## Task 3: AppContext — estado e ações de `checkinSettings`

**Files:**
- Modify: `src/context/AppContext.tsx`

- [ ] **Step 1: Declarar o tipo `CheckinSettings`**

No topo de `src/context/AppContext.tsx`, junto às outras interfaces exportadas (ex: perto de `export interface Directorate`), adicione:

```ts
export interface CheckinSettings {
  id: number;
  start_minutes: number;
  end_minutes: number;
  office_latitude: number;
  office_longitude: number;
  max_radius_meters: number;
  max_accuracy_meters: number;
  updated_at?: string;
  updated_by?: string | null;
}
```

- [ ] **Step 2: Adicionar ao contrato do contexto (interface `AppContextValue`)**

Logo após o bloco "Admin - Diretorias" na interface (atual linha ~240, após `deleteDirectorate`), adicione:

```ts
  // Admin - Configuração de Check-in
  checkinSettings: CheckinSettings | null;
  refreshCheckinSettings: () => Promise<void>;
  updateCheckinSettings: (data: Partial<Omit<CheckinSettings, 'id' | 'updated_at' | 'updated_by'>>) => Promise<void>;
```

- [ ] **Step 3: Adicionar o estado**

Junto às outras chamadas `useState` do provider (atual linha ~277, perto de `const [directorates, setDirectorates] = ...`), adicione:

```ts
  const [checkinSettings, setCheckinSettings] = useState<CheckinSettings | null>(null);
```

- [ ] **Step 4: Implementar `refreshCheckinSettings` e `updateCheckinSettings`**

Logo após o bloco de Diretorias (após `deleteDirectorate`, atual linha ~1814), adicione:

```ts
  // ─── Check-in Settings ────────────────────────────────────────────────────

  const refreshCheckinSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('checkin_settings')
        .select('*')
        .eq('id', 1)
        .maybeSingle();
      if (error) throw error;
      setCheckinSettings((data as CheckinSettings) ?? null);
    } catch (e) { console.error('Erro ao carregar config de check-in:', e); }
  }, []);

  const updateCheckinSettings = useCallback(async (
    data: Partial<Omit<CheckinSettings, 'id' | 'updated_at' | 'updated_by'>>,
  ) => {
    try {
      const { error } = await supabase
        .from('checkin_settings')
        .update({ ...data, updated_at: new Date().toISOString(), updated_by: userRef.current?.id ?? null })
        .eq('id', 1);
      if (error) throw error;
      await refreshCheckinSettings();
    } catch (e) {
      console.error('Erro ao salvar config de check-in:', e);
      throw e;
    }
  }, [refreshCheckinSettings]);
```

- [ ] **Step 5: Carregar na inicialização**

No `Promise.all([...])` de carga inicial (atual linha ~1951-1964), adicione `refreshCheckinSettings()` à lista:

```ts
        refreshProfiles(),
        refreshDirectorates(),
        refreshCheckinSettings(),
      ]);
```

E inclua `refreshCheckinSettings` no array de dependências desse `useCallback` (atual linha ~1970):

```ts
  }, [refreshClients, refreshLeads, refreshAppointments, refreshTasks, refreshDevelopments, refreshTeams, refreshGoals, refreshAnnouncements, refreshProfiles, refreshDirectorates, refreshCheckinSettings]);
```

- [ ] **Step 6: Expor no value do provider**

No objeto passado para `<AppContext.Provider value={{ ... }}>` (atual linha ~2041, perto de `directorates, refreshDirectorates,`), adicione:

```ts
      checkinSettings, refreshCheckinSettings, updateCheckinSettings,
```

- [ ] **Step 7: Verificar build**

Run: `npm run build`
Expected: build conclui com sucesso (sem novos erros de TypeScript; warnings de chunk são pré-existentes).

- [ ] **Step 8: Commit**

```bash
git add src/context/AppContext.tsx
git commit -m "feat(checkin): checkinSettings no AppContext (estado, refresh, update)"
```

---

## Task 4: AdminPanel — nova aba "Check-in" (só ADMIN)

**Files:**
- Modify: `src/pages/admin/AdminPanel.tsx`

- [ ] **Step 1: Importar o ícone `Clock` e o tipo/ação do contexto**

No import de `lucide-react` (linha 3), adicione `Clock` à lista de ícones (mantenha os demais):

```ts
import { Users, Shield, ShieldCheck, Target, Megaphone, BarChart3, Plus, Search, Trophy, Download, FileSpreadsheet, FileText, Trash2, Edit2, ChevronDown, ChevronLeft, Calendar, Loader2, Building2, TrendingUp, Printer, Star, Award, Zap, Flame, MoreHorizontal, FileDown, MapPin, Clock } from 'lucide-react';
```

No destructuring de `useApp()` (atual linha ~24-33), adicione `checkinSettings, updateCheckinSettings`:

```ts
    directorates, addDirectorate, updateDirectorate, deleteDirectorate,
    checkinSettings, updateCheckinSettings,
    clients, leads, appointments,
```

- [ ] **Step 2: Adicionar `'checkin'` ao tipo `Tab`**

Na linha 17, estenda o tipo:

```ts
type Tab = 'users' | 'teams' | 'goals' | 'announcements' | 'reports' | 'directorates' | 'gamification' | 'checkin';
```

- [ ] **Step 3: Adicionar estado local do formulário**

Junto aos outros `useState` do componente (perto da linha ~67, após o bloco do Directorate modal), adicione:

```ts
  // Check-in settings form
  const [checkinForm, setCheckinForm] = useState({
    start: '08:00',
    end: '13:30',
    lat: '-23.5505',
    lng: '-46.6333',
    radius: '1000',
    accuracy: '120',
  });
  const [isSavingCheckin, setIsSavingCheckin] = useState(false);
  const [isLocatingCheckin, setIsLocatingCheckin] = useState(false);
```

- [ ] **Step 4: Adicionar helpers de conversão e sincronização do formulário**

Logo abaixo dos `useState` adicionados (ainda dentro do componente, antes do `return`), adicione os helpers e um efeito que popula o formulário quando as settings chegam:

```ts
  const minutesToHHMM = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const hhmmToMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
    return (h || 0) * 60 + (m || 0);
  };

  useEffect(() => {
    if (!checkinSettings) return;
    setCheckinForm({
      start: minutesToHHMM(checkinSettings.start_minutes),
      end: minutesToHHMM(checkinSettings.end_minutes),
      lat: String(checkinSettings.office_latitude),
      lng: String(checkinSettings.office_longitude),
      radius: String(checkinSettings.max_radius_meters),
      accuracy: String(checkinSettings.max_accuracy_meters),
    });
  }, [checkinSettings]);
```

> Nota: `useEffect` já é importado neste arquivo (usado em outros pontos). Se o linter acusar import ausente, adicione `useEffect` ao import de `react`.

- [ ] **Step 5: Adicionar o handler de "usar minha localização atual"**

Logo abaixo dos helpers, adicione:

```ts
  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocalização não suportada neste dispositivo.');
      return;
    }
    setIsLocatingCheckin(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCheckinForm((prev) => ({
          ...prev,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }));
        setIsLocatingCheckin(false);
      },
      (err) => {
        setIsLocatingCheckin(false);
        alert(
          err.code === err.PERMISSION_DENIED
            ? 'Permissão de localização negada. Permita o acesso ao GPS ou digite as coordenadas manualmente.'
            : 'Não foi possível obter a localização. Tente novamente ou digite manualmente.',
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
```

- [ ] **Step 6: Adicionar o handler de salvar (com validação inline)**

Logo abaixo do handler anterior, adicione:

```ts
  const handleSaveCheckin = async () => {
    const startMin = hhmmToMinutes(checkinForm.start);
    const endMin = hhmmToMinutes(checkinForm.end);
    const lat = parseFloat(checkinForm.lat);
    const lng = parseFloat(checkinForm.lng);
    const radius = parseInt(checkinForm.radius, 10);
    const accuracy = parseInt(checkinForm.accuracy, 10);

    if (endMin <= startMin) { alert('O horário de fim deve ser maior que o de início.'); return; }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { alert('Latitude inválida (deve estar entre -90 e 90).'); return; }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) { alert('Longitude inválida (deve estar entre -180 e 180).'); return; }
    if (!Number.isFinite(radius) || radius < 50 || radius > 50000) { alert('Raio inválido (50 a 50000 metros).'); return; }
    if (!Number.isFinite(accuracy) || accuracy < 10 || accuracy > 1000) { alert('Precisão inválida (10 a 1000 metros).'); return; }

    setIsSavingCheckin(true);
    try {
      await updateCheckinSettings({
        start_minutes: startMin,
        end_minutes: endMin,
        office_latitude: lat,
        office_longitude: lng,
        max_radius_meters: radius,
        max_accuracy_meters: accuracy,
      });
      alert('Configuração de check-in salva com sucesso.');
    } catch (e: any) {
      alert(`Erro ao salvar: ${e?.message || 'tente novamente.'}`);
    } finally {
      setIsSavingCheckin(false);
    }
  };
```

- [ ] **Step 7: Adicionar a aba na barra de navegação**

No array de abas (atual linha ~2246-2253), adicione a entrada de check-in com `adminOnly: true` (logo após `gamification`):

```tsx
          { id: 'gamification', label: 'Gamificação', icon: Zap },
          { id: 'checkin', label: 'Check-in', icon: Clock, adminOnly: true },
```

- [ ] **Step 8: Adicionar o bloco de conteúdo da aba**

Dentro do container `<div className="w-full animate-in fade-in slide-in-from-bottom-4 duration-500">` (a partir da linha ~2268), junto aos outros blocos `{activeTab === '...' && (...)}`, adicione:

```tsx
        {activeTab === 'checkin' && (
          <section className="max-w-2xl space-y-5">
            <PremiumCard className="p-5 space-y-5">
              <div>
                <h3 className="text-lg font-bold text-text-primary flex items-center gap-2">
                  <Clock size={18} className="text-gold-500" /> Janela de horário (BRT)
                </h3>
                <p className="text-xs text-text-secondary mt-1">Horário em que o check-in fica liberado, todos os dias.</p>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary block mb-1">Início</label>
                    <input type="time" value={checkinForm.start}
                      onChange={(e) => setCheckinForm((p) => ({ ...p, start: e.target.value }))}
                      className="w-full h-10 px-3 bg-surface-50 rounded-md border border-surface-200 text-sm text-text-primary focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary block mb-1">Fim</label>
                    <input type="time" value={checkinForm.end}
                      onChange={(e) => setCheckinForm((p) => ({ ...p, end: e.target.value }))}
                      className="w-full h-10 px-3 bg-surface-50 rounded-md border border-surface-200 text-sm text-text-primary focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300" />
                  </div>
                </div>
              </div>

              <div className="border-t border-surface-200 pt-5">
                <h3 className="text-lg font-bold text-text-primary flex items-center gap-2">
                  <MapPin size={18} className="text-gold-500" /> Localização do escritório
                </h3>
                <p className="text-xs text-text-secondary mt-1">Ponto central a partir do qual o raio é medido.</p>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary block mb-1">Latitude</label>
                    <input type="text" inputMode="decimal" value={checkinForm.lat}
                      onChange={(e) => setCheckinForm((p) => ({ ...p, lat: e.target.value }))}
                      className="w-full h-10 px-3 bg-surface-50 rounded-md border border-surface-200 text-sm text-text-primary focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300" />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary block mb-1">Longitude</label>
                    <input type="text" inputMode="decimal" value={checkinForm.lng}
                      onChange={(e) => setCheckinForm((p) => ({ ...p, lng: e.target.value }))}
                      className="w-full h-10 px-3 bg-surface-50 rounded-md border border-surface-200 text-sm text-text-primary focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300" />
                  </div>
                </div>
                <RoundedButton variant="secondary" size="sm" className="mt-3" onClick={handleUseCurrentLocation} disabled={isLocatingCheckin}>
                  {isLocatingCheckin ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
                  {isLocatingCheckin ? 'Obtendo localização...' : 'Usar minha localização atual'}
                </RoundedButton>
              </div>

              <div className="border-t border-surface-200 pt-5">
                <h3 className="text-lg font-bold text-text-primary">Tolerâncias do GPS</h3>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary block mb-1">Raio máximo (m)</label>
                    <input type="number" min={50} max={50000} value={checkinForm.radius}
                      onChange={(e) => setCheckinForm((p) => ({ ...p, radius: e.target.value }))}
                      className="w-full h-10 px-3 bg-surface-50 rounded-md border border-surface-200 text-sm text-text-primary focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300" />
                    <p className="text-[10px] text-text-secondary mt-1">Distância máxima permitida do escritório.</p>
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary block mb-1">Precisão mínima (m)</label>
                    <input type="number" min={10} max={1000} value={checkinForm.accuracy}
                      onChange={(e) => setCheckinForm((p) => ({ ...p, accuracy: e.target.value }))}
                      className="w-full h-10 px-3 bg-surface-50 rounded-md border border-surface-200 text-sm text-text-primary focus:ring-2 focus:ring-gold-400/70 focus:border-gold-300" />
                    <p className="text-[10px] text-text-secondary mt-1">Rejeita GPS com erro maior que isso.</p>
                  </div>
                </div>
              </div>

              <div className="border-t border-surface-200 pt-5">
                <RoundedButton fullWidth onClick={handleSaveCheckin} disabled={isSavingCheckin}>
                  {isSavingCheckin ? 'Salvando...' : 'Salvar configuração'}
                </RoundedButton>
              </div>
            </PremiumCard>
          </section>
        )}
```

- [ ] **Step 9: Verificar build**

Run: `npm run build`
Expected: build conclui com sucesso. Se acusar `useEffect` não importado, adicione-o ao import de `react` no topo do arquivo e rode de novo.

- [ ] **Step 10: Commit**

```bash
git add src/pages/admin/AdminPanel.tsx
git commit -m "feat(checkin): aba Check-in no painel admin (somente ADMIN)"
```

---

## Task 5: `CheckIn.tsx` usa o horário configurado na exibição

**Files:**
- Modify: `src/pages/CheckIn.tsx`

- [ ] **Step 1: Ler `checkinSettings` do contexto**

Na linha 54, adicione `checkinSettings` ao destructuring de `useApp()`:

```ts
  const { user, profile, signOut, checkinSettings } = useApp();
```

- [ ] **Step 2: Derivar a janela e os rótulos a partir das settings (com fallback)**

Substitua a linha 220 (`const isOpen = brtMinutes >= (8 * 60) && brtMinutes <= (13 * 60 + 30);`) por:

```ts
  // Janela de check-in (configurável via checkin_settings; fallback 08:00-13:30)
  const startMin = checkinSettings?.start_minutes ?? (8 * 60);
  const endMin = checkinSettings?.end_minutes ?? (13 * 60 + 30);
  const fmtMin = (min: number) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const windowLabel = `${fmtMin(startMin)} – ${fmtMin(endMin)}`;
  const isOpen = brtMinutes >= startMin && brtMinutes <= endMin;
```

- [ ] **Step 3: Usar `windowLabel`/`fmtMin` nos textos exibidos**

Linha 484 — substitua:

```tsx
            {isOpen ? 'Janela de check-in aberta' : `Disponível das ${windowLabel}`}
```

Linha 521 — substitua:

```tsx
            {isOpen ? `Aberto · ${windowLabel}` : `Fechado · abre às ${fmtMin(startMin)}`}
```

Linha 731 (dentro do array de info cards) — substitua o objeto do "Horário de check-in":

```tsx
               { icon: Clock,    label: 'Horário de check-in', value: windowLabel },
```

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build conclui com sucesso.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CheckIn.tsx
git commit -m "feat(checkin): tela de check-in exibe a janela configurada"
```

---

## Task 6: Build final consolidado

**Files:** nenhum (verificação)

- [ ] **Step 1: Rodar o build completo**

Run: `npm run build`
Expected: `✓ built in ...s` sem novos erros de TypeScript.

- [ ] **Step 2: Revisar o diff completo da branch**

Run: `git log --oneline preview/v3..HEAD`
Expected: commits das Tasks 1-5 presentes, na ordem.

---

## Task 7: Aplicação no preview + UAT manual

> Estas etapas exigem ambiente Supabase (token de acesso já usado nesta sessão) e o app rodando. Aplicar **somente** no projeto de preview/produção do usuário após revisão — produção (`main`) não é tocada pelo código, apenas o banco/edge do projeto Supabase configurado.

- [ ] **Step 1: Aplicar a migration**

Aplicar via SQL Editor do Supabase (cole o conteúdo de `supabase/migrations/20260621120000_create_checkin_settings.sql`) ou `supabase db push`. Confirmar que a tabela `checkin_settings` existe com 1 linha (`select * from checkin_settings;` → 1 linha com os defaults).

- [ ] **Step 2: Deploy da edge function**

```bash
supabase functions deploy checkin-geo
```
(Esta função usa JWT — NÃO usar `--no-verify-jwt`, diferente da secure-login.)

- [ ] **Step 3: UAT — checklist**

  - [ ] A aba "Check-in" aparece no painel admin para ADMIN e **não** aparece para não-ADMIN.
  - [ ] O formulário carrega com os valores atuais (08:00 / 13:30 / coordenadas / 1000 / 120).
  - [ ] "Usar minha localização atual" preenche latitude/longitude.
  - [ ] Salvar persiste: reabrir a aba mostra os novos valores.
  - [ ] Validação inline funciona (ex: fim ≤ início, raio fora de faixa → alerta, não salva).
  - [ ] Alterar a janela para um horário que exclua o agora → check-in retorna "fora_do_horario" com o novo horário na mensagem; a tela de check-in exibe a nova janela.
  - [ ] Restaurar a janela válida → check-in volta a funcionar dentro do raio.
  - [ ] Fallback: (opcional) com a tabela vazia, a edge function ainda aceita check-in usando os defaults.

- [ ] **Step 4: Push da branch**

```bash
git push -u origin preview/checkin-settings
```

---

## Self-Review (preenchido pelo autor do plano)

- **Cobertura da spec:** tabela + constraints + RLS + seed (Task 1) ✓; edge function lê com fallback (Task 2) ✓; AppContext (Task 3) ✓; aba admin só-ADMIN com horário/local/raio/precisão + botão GPS + validação (Task 4) ✓; CheckIn.tsx exibição coerente (Task 5) ✓; branch isolada e deploy só após UAT (Tasks 6-7) ✓.
- **Placeholders:** nenhum — todo passo tem código/comando concretos.
- **Consistência de tipos:** `CheckinSettings` (snake_case do banco) usado igual em AppContext, AdminPanel e CheckIn; `updateCheckinSettings` assina `Partial<Omit<...>>` e é chamada com as 6 chaves; colunas batem com a migration.
