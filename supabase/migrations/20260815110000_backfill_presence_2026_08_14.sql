-- ============================================================
-- BACKFILL DE PRESENÇA: 14/08/2026 (somente este dia)
-- Migration: 20260815110000_backfill_presence_2026_08_14.sql
-- ============================================================
-- Registra check-in retroativo para todos os usuários em 2026-08-14.
-- Não altera status_presenca atual nem concede XP — apenas histórico
-- em daily_checkins para relatórios e auditoria daquele dia.

CREATE OR REPLACE FUNCTION public.admin_backfill_daily_presence(
  p_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE := COALESCE(p_date, CURRENT_DATE);
  v_base_pos INTEGER;
  v_inserted INTEGER;
  v_role TEXT;
  v_is_db_admin BOOLEAN;
BEGIN
  v_role := UPPER(COALESCE(public.app_current_user_role(), ''));
  v_is_db_admin := current_user IN ('postgres', 'supabase_admin');

  IF NOT v_is_db_admin
     AND auth.role() <> 'service_role'
     AND v_role NOT IN ('ADMIN', 'DIRETOR') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT COALESCE(MAX(position_in_queue), 0)
  INTO v_base_pos
  FROM public.daily_checkins
  WHERE checkin_date = v_date;

  INSERT INTO public.daily_checkins (
    user_id,
    checkin_date,
    checkin_time,
    position_in_queue
  )
  SELECT
    p.id,
    v_date,
    (v_date::TIMESTAMP AT TIME ZONE 'America/Sao_Paulo') + INTERVAL '9 hours',
    v_base_pos + ROW_NUMBER() OVER (ORDER BY p.name NULLS LAST, p.id)
  FROM public.profiles p
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.daily_checkins dc
    WHERE dc.user_id = p.id
      AND dc.checkin_date = v_date
  );

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', TRUE,
    'date', v_date,
    'inserted', v_inserted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_backfill_daily_presence(DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_backfill_daily_presence(DATE) TO service_role;

SELECT public.admin_backfill_daily_presence(DATE '2026-08-14');
