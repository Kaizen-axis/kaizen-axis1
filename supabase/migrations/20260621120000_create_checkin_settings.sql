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
