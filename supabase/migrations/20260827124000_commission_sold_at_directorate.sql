-- Bootstrap completo: cria commission_entries se ainda não existir,
-- trigger a partir do Espelho, sold_at (data_contrato/closed_at/now) e RLS.

CREATE OR REPLACE FUNCTION public.parse_brl_numeric(p_value text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_clean text;
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN 0;
  END IF;

  v_clean := regexp_replace(p_value, '[^0-9,.-]', '', 'g');

  IF position(',' in v_clean) > 0 THEN
    v_clean := replace(replace(v_clean, '.', ''), ',', '.');
  END IF;

  IF v_clean IS NULL OR v_clean IN ('', '-', '.', '-.') THEN
    RETURN 0;
  END IF;

  BEGIN
    RETURN v_clean::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN 0;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.parse_br_date(p_value text)
RETURNS timestamptz
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v text;
  d int;
  m int;
  y int;
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN NULL;
  END IF;
  v := btrim(p_value);
  IF v ~ '^\d{4}-\d{2}-\d{2}' THEN
    RETURN (substring(v from 1 for 10))::date::timestamptz;
  END IF;
  IF v ~ '^\d{2}/\d{2}/\d{4}' THEN
    d := substring(v from 1 for 2)::int;
    m := substring(v from 4 for 2)::int;
    y := substring(v from 7 for 4)::int;
    IF m BETWEEN 1 AND 12 AND d BETWEEN 1 AND 31 THEN
      RETURN make_date(y, m, d)::timestamptz;
    END IF;
  END IF;
  RETURN NULL;
EXCEPTION
  WHEN others THEN
    RETURN NULL;
END;
$$;

CREATE TABLE IF NOT EXISTS public.commission_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES public.clients(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  directorate_id uuid REFERENCES public.directorates(id) ON DELETE SET NULL,
  team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  cliente_nome text,
  empreendimento text,
  unidade text,
  corretor_nome text,
  coordenador_nome text,
  gerente_nome text,
  vgv_numeric numeric(14, 2) NOT NULL DEFAULT 0,
  commission_amount numeric(14, 2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid')),
  due_date date,
  paid_at timestamptz,
  paid_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sold_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commission_entries_sold_at_idx
  ON public.commission_entries (sold_at DESC);

CREATE INDEX IF NOT EXISTS commission_entries_owner_idx
  ON public.commission_entries (owner_id);

CREATE INDEX IF NOT EXISTS commission_entries_directorate_idx
  ON public.commission_entries (directorate_id);

CREATE INDEX IF NOT EXISTS commission_entries_status_idx
  ON public.commission_entries (payment_status);

CREATE OR REPLACE FUNCTION public.sync_commission_entry_from_sales_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client record;
  v_vgv numeric;
  v_directorate uuid;
  v_sold_at timestamptz;
BEGIN
  SELECT
    c.id,
    c.stage,
    c.owner_id,
    (SELECT d.id FROM public.directorates d WHERE d.id = c.directorate_id) AS client_directorate_id,
    (SELECT d.id FROM public.directorates d WHERE d.id = p.directorate_id) AS owner_directorate_id,
    (SELECT t.id FROM public.teams t WHERE t.id = p.team_id) AS team_id,
    c.name,
    c.intended_value,
    c.closed_at
  INTO v_client
  FROM public.clients c
  LEFT JOIN public.profiles p ON p.id = c.owner_id
  WHERE c.id = NEW.client_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_client.stage IS DISTINCT FROM 'Concluído' THEN
    RETURN NEW;
  END IF;

  v_vgv := public.parse_brl_numeric(COALESCE(NULLIF(btrim(NEW.vgv), ''), v_client.intended_value));
  v_directorate := COALESCE(v_client.client_directorate_id, v_client.owner_directorate_id);
  v_sold_at := COALESCE(public.parse_br_date(NEW.data_contrato), v_client.closed_at, now());

  INSERT INTO public.commission_entries (
    client_id,
    owner_id,
    directorate_id,
    team_id,
    cliente_nome,
    empreendimento,
    unidade,
    corretor_nome,
    coordenador_nome,
    gerente_nome,
    vgv_numeric,
    commission_amount,
    sold_at,
    updated_at
  ) VALUES (
    NEW.client_id,
    v_client.owner_id,
    v_directorate,
    v_client.team_id,
    COALESCE(NULLIF(btrim(NEW.cliente_1), ''), v_client.name),
    NEW.empreendimento,
    NEW.unidade,
    NEW.corretor,
    NEW.coordenador,
    NEW.gerente,
    v_vgv,
    ROUND(v_vgv * 0.018 * 0.86, 2),
    v_sold_at,
    now()
  )
  ON CONFLICT (client_id) DO UPDATE SET
    owner_id = EXCLUDED.owner_id,
    directorate_id = EXCLUDED.directorate_id,
    team_id = EXCLUDED.team_id,
    cliente_nome = EXCLUDED.cliente_nome,
    empreendimento = EXCLUDED.empreendimento,
    unidade = EXCLUDED.unidade,
    corretor_nome = EXCLUDED.corretor_nome,
    coordenador_nome = EXCLUDED.coordenador_nome,
    gerente_nome = EXCLUDED.gerente_nome,
    vgv_numeric = EXCLUDED.vgv_numeric,
    commission_amount = EXCLUDED.commission_amount,
    sold_at = COALESCE(public.commission_entries.sold_at, EXCLUDED.sold_at),
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_commission_entry_from_sales_mirror ON public.sales_mirrors;
CREATE TRIGGER trg_sync_commission_entry_from_sales_mirror
AFTER INSERT OR UPDATE ON public.sales_mirrors
FOR EACH ROW
EXECUTE FUNCTION public.sync_commission_entry_from_sales_mirror();

INSERT INTO public.commission_entries (
  client_id,
  owner_id,
  directorate_id,
  team_id,
  cliente_nome,
  empreendimento,
  unidade,
  corretor_nome,
  coordenador_nome,
  gerente_nome,
  vgv_numeric,
  commission_amount,
  sold_at
)
SELECT
  sm.client_id,
  c.owner_id,
  COALESCE(
    (SELECT d.id FROM public.directorates d WHERE d.id = c.directorate_id),
    (SELECT d.id FROM public.directorates d WHERE d.id = p.directorate_id)
  ),
  (SELECT t.id FROM public.teams t WHERE t.id = p.team_id),
  COALESCE(NULLIF(btrim(sm.cliente_1), ''), c.name),
  sm.empreendimento,
  sm.unidade,
  sm.corretor,
  sm.coordenador,
  sm.gerente,
  public.parse_brl_numeric(COALESCE(NULLIF(btrim(sm.vgv), ''), c.intended_value)),
  ROUND(public.parse_brl_numeric(COALESCE(NULLIF(btrim(sm.vgv), ''), c.intended_value)) * 0.018 * 0.86, 2),
  COALESCE(public.parse_br_date(sm.data_contrato), c.closed_at, sm.created_at, now())
FROM public.sales_mirrors sm
JOIN public.clients c ON c.id = sm.client_id
LEFT JOIN public.profiles p ON p.id = c.owner_id
WHERE c.stage = 'Concluído'
ON CONFLICT (client_id) DO NOTHING;

UPDATE public.commission_entries ce
SET directorate_id = COALESCE(
  (SELECT d.id
   FROM public.clients c
   JOIN public.directorates d ON d.id = c.directorate_id
   WHERE c.id = ce.client_id),
  (SELECT d.id
   FROM public.profiles p
   JOIN public.directorates d ON d.id = p.directorate_id
   WHERE p.id = ce.owner_id)
)
WHERE ce.directorate_id IS NULL;

ALTER TABLE public.commission_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commission_entries_select_leadership ON public.commission_entries;
CREATE POLICY commission_entries_select_leadership
ON public.commission_entries
FOR SELECT
TO authenticated
USING (
  public.app_current_user_role() = 'ADMIN'
  OR (
    public.app_current_user_role() = 'DIRETOR'
    AND (
      directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
      OR (
        directorate_id IS NULL
        AND (
          owner_id IN (
            SELECT p.id FROM public.profiles p
            WHERE p.directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
          )
          OR owner_id IS NULL
        )
      )
    )
  )
);

DROP POLICY IF EXISTS commission_entries_update_leadership ON public.commission_entries;
CREATE POLICY commission_entries_update_leadership
ON public.commission_entries
FOR UPDATE
TO authenticated
USING (
  public.app_current_user_role() = 'ADMIN'
  OR (
    public.app_current_user_role() = 'DIRETOR'
    AND (
      directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
      OR (
        directorate_id IS NULL
        AND (
          owner_id IN (
            SELECT p.id FROM public.profiles p
            WHERE p.directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
          )
          OR owner_id IS NULL
        )
      )
    )
  )
)
WITH CHECK (
  public.app_current_user_role() = 'ADMIN'
  OR (
    public.app_current_user_role() = 'DIRETOR'
    AND (
      directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
      OR (
        directorate_id IS NULL
        AND (
          owner_id IN (
            SELECT p.id FROM public.profiles p
            WHERE p.directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
          )
          OR owner_id IS NULL
        )
      )
    )
  )
);

REVOKE ALL ON TABLE public.commission_entries FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON TABLE public.commission_entries TO authenticated;
GRANT ALL ON TABLE public.commission_entries TO service_role;

REVOKE ALL ON FUNCTION public.parse_brl_numeric(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parse_brl_numeric(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.parse_br_date(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.parse_br_date(text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.sync_commission_entry_from_sales_mirror() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_commission_entry_from_sales_mirror() TO service_role;
