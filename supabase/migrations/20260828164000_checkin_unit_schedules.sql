-- Horários independentes por unidade. A configuração singleton anterior é
-- preservada para compatibilidade com a função de check-in de produção.

ALTER TABLE public.checkin_units
  ADD COLUMN IF NOT EXISTS start_minutes smallint NOT NULL DEFAULT 480,
  ADD COLUMN IF NOT EXISTS end_minutes smallint NOT NULL DEFAULT 810;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkin_units_start_minutes_range'
      AND conrelid = 'public.checkin_units'::regclass
  ) THEN
    ALTER TABLE public.checkin_units
      ADD CONSTRAINT checkin_units_start_minutes_range
      CHECK (start_minutes >= 0 AND start_minutes < 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkin_units_end_minutes_range'
      AND conrelid = 'public.checkin_units'::regclass
  ) THEN
    ALTER TABLE public.checkin_units
      ADD CONSTRAINT checkin_units_end_minutes_range
      CHECK (end_minutes > 0 AND end_minutes < 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'checkin_units_window_order'
      AND conrelid = 'public.checkin_units'::regclass
  ) THEN
    ALTER TABLE public.checkin_units
      ADD CONSTRAINT checkin_units_window_order
      CHECK (end_minutes > start_minutes);
  END IF;
END
$$;
