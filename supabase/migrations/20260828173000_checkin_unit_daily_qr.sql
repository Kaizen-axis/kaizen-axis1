-- QR diário por unidade. Estrutura aditiva para manter o QR global usado pela
-- produção funcionando enquanto a implementação é validada no preview.

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

-- A unidade nunca é informada pelo navegador. Ela é derivada do perfil
-- autenticado ou do cargo técnico da recepção.
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
  WHERE code = v_unit_code
    AND active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unidade de check-in indisponível.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.daily_qr_tokens_by_unit (token_date, unit_code)
  VALUES (v_today, v_unit_code)
  ON CONFLICT (token_date, unit_code) DO NOTHING;

  SELECT token
  INTO v_token
  FROM public.daily_qr_tokens_by_unit
  WHERE token_date = v_today
    AND unit_code = v_unit_code;

  RETURN jsonb_build_object(
    'token', v_token,
    'unit_code', v_unit_code,
    'unit_name', v_unit_name,
    'start_minutes', v_start_minutes,
    'end_minutes', v_end_minutes
  );
END;
$$;

-- Usada exclusivamente pela Edge Function v2 com service_role. A validação
-- exige simultaneamente data local, unidade atribuída e token.
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

REVOKE ALL ON FUNCTION public.get_or_create_unit_daily_qr()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.validate_unit_daily_qr(text, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_or_create_unit_daily_qr() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_unit_daily_qr(text, text) TO service_role;
