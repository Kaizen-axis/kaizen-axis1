-- Check-in multiunidade: unidades fixas, vínculo protegido no perfil e janela
-- global configurável. Todas as mudanças são aditivas para manter o frontend e
-- a Edge Function atuais de produção funcionando durante o preview.

CREATE TABLE IF NOT EXISTS public.checkin_units (
  code                  text PRIMARY KEY,
  name                  text NOT NULL,
  latitude              double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude             double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  max_radius_meters     integer NOT NULL CHECK (max_radius_meters BETWEEN 50 AND 50000),
  max_accuracy_meters   integer NOT NULL CHECK (max_accuracy_meters BETWEEN 10 AND 1000),
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.checkin_units (
  code,
  name,
  latitude,
  longitude,
  max_radius_meters,
  max_accuracy_meters,
  active
)
VALUES
  ('zona_oeste', 'Zona Oeste', -22.903084, -43.561000, 1000, 120, true),
  ('zona_norte', 'Zona Norte', -22.887190, -43.282140, 1000, 120, true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  latitude = EXCLUDED.latitude,
  longitude = EXCLUDED.longitude,
  max_radius_meters = EXCLUDED.max_radius_meters,
  max_accuracy_meters = EXCLUDED.max_accuracy_meters,
  active = EXCLUDED.active,
  updated_at = now();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS checkin_unit_code text;

UPDATE public.profiles
SET checkin_unit_code = 'zona_oeste'
WHERE checkin_unit_code IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN checkin_unit_code SET DEFAULT 'zona_oeste',
  ALTER COLUMN checkin_unit_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_checkin_unit_code_fkey'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_checkin_unit_code_fkey
      FOREIGN KEY (checkin_unit_code)
      REFERENCES public.checkin_units(code);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_profiles_checkin_unit_code
  ON public.profiles(checkin_unit_code);

-- Pode já existir por causa de um preview anterior. Os ALTERs abaixo completam
-- a estrutura sem apagar horário ou colunas legadas de localização.
CREATE TABLE IF NOT EXISTS public.checkin_settings (
  id             smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  start_minutes  smallint NOT NULL DEFAULT 480,
  end_minutes    smallint NOT NULL DEFAULT 810,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.checkin_settings
  ADD COLUMN IF NOT EXISTS start_minutes smallint NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS end_minutes smallint NOT NULL DEFAULT 810,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

INSERT INTO public.checkin_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkin_settings_start_minutes_range'
      AND conrelid = 'public.checkin_settings'::regclass
  ) THEN
    ALTER TABLE public.checkin_settings
      ADD CONSTRAINT checkin_settings_start_minutes_range
      CHECK (start_minutes >= 0 AND start_minutes < 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkin_settings_end_minutes_range'
      AND conrelid = 'public.checkin_settings'::regclass
  ) THEN
    ALTER TABLE public.checkin_settings
      ADD CONSTRAINT checkin_settings_end_minutes_range
      CHECK (end_minutes > 0 AND end_minutes < 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkin_settings_window_order'
      AND conrelid = 'public.checkin_settings'::regclass
  ) THEN
    ALTER TABLE public.checkin_settings
      ADD CONSTRAINT checkin_settings_window_order
      CHECK (end_minutes > start_minutes);
  END IF;
END
$$;

-- A policy atual de profiles permite que o usuário atualize o próprio perfil.
-- A trigger protege especificamente o vínculo de unidade contra autoalteração.
CREATE OR REPLACE FUNCTION public.protect_profile_checkin_unit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.checkin_unit_code IS DISTINCT FROM OLD.checkin_unit_code
    AND COALESCE((SELECT auth.role()), '') <> 'service_role'
    AND COALESCE((SELECT public.app_current_user_role()), '') <> 'ADMIN'
  THEN
    RAISE EXCEPTION 'Somente administradores podem alterar a unidade de check-in.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_profile_checkin_unit() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_protect_profile_checkin_unit ON public.profiles;
CREATE TRIGGER trg_protect_profile_checkin_unit
BEFORE UPDATE OF checkin_unit_code ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.protect_profile_checkin_unit();

ALTER TABLE public.checkin_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_units FORCE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkin_settings FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checkin_units_select_authenticated ON public.checkin_units;
CREATE POLICY checkin_units_select_authenticated
ON public.checkin_units
FOR SELECT
TO authenticated
USING (
  active
  OR (SELECT public.app_current_user_role()) = 'ADMIN'
);

DROP POLICY IF EXISTS checkin_units_insert_admin ON public.checkin_units;
CREATE POLICY checkin_units_insert_admin
ON public.checkin_units
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.app_current_user_role()) = 'ADMIN');

DROP POLICY IF EXISTS checkin_units_update_admin ON public.checkin_units;
CREATE POLICY checkin_units_update_admin
ON public.checkin_units
FOR UPDATE
TO authenticated
USING ((SELECT public.app_current_user_role()) = 'ADMIN')
WITH CHECK ((SELECT public.app_current_user_role()) = 'ADMIN');

DROP POLICY IF EXISTS checkin_settings_select_authenticated ON public.checkin_settings;
CREATE POLICY checkin_settings_select_authenticated
ON public.checkin_settings
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS checkin_settings_insert_admin ON public.checkin_settings;
CREATE POLICY checkin_settings_insert_admin
ON public.checkin_settings
FOR INSERT
TO authenticated
WITH CHECK ((SELECT public.app_current_user_role()) = 'ADMIN');

DROP POLICY IF EXISTS checkin_settings_update_admin ON public.checkin_settings;
CREATE POLICY checkin_settings_update_admin
ON public.checkin_settings
FOR UPDATE
TO authenticated
USING ((SELECT public.app_current_user_role()) = 'ADMIN')
WITH CHECK ((SELECT public.app_current_user_role()) = 'ADMIN');

REVOKE ALL ON public.checkin_units FROM anon;
REVOKE ALL ON public.checkin_settings FROM anon;

GRANT SELECT, INSERT, UPDATE ON public.checkin_units TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.checkin_settings TO authenticated;
GRANT SELECT ON public.checkin_units TO service_role;
GRANT SELECT ON public.checkin_settings TO service_role;
