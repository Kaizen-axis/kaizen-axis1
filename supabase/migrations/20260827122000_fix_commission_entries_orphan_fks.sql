-- Corrige backfill/trigger: profiles.team_id/directorate_id podem apontar para linhas
-- que já não existem em teams/directorates. Grava NULL nesses casos.
-- Também completa RLS se a 20260827120000 parou no INSERT, e inclui joined_at na RPC de perfil.

CREATE OR REPLACE FUNCTION public.sync_commission_entry_from_sales_mirror()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client record;
  v_vgv numeric;
BEGIN
  SELECT
    c.id,
    c.stage,
    c.owner_id,
    (SELECT d.id FROM public.directorates d WHERE d.id = c.directorate_id) AS directorate_id,
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
    v_client.directorate_id,
    v_client.team_id,
    COALESCE(NULLIF(btrim(NEW.cliente_1), ''), v_client.name),
    NEW.empreendimento,
    NEW.unidade,
    NEW.corretor,
    NEW.coordenador,
    NEW.gerente,
    v_vgv,
    ROUND(v_vgv * 0.018 * 0.86, 2),
    COALESCE(v_client.closed_at, now()),
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
  (SELECT d.id FROM public.directorates d WHERE d.id = c.directorate_id),
  (SELECT t.id FROM public.teams t WHERE t.id = p.team_id),
  COALESCE(NULLIF(btrim(sm.cliente_1), ''), c.name),
  sm.empreendimento,
  sm.unidade,
  sm.corretor,
  sm.coordenador,
  sm.gerente,
  public.parse_brl_numeric(COALESCE(NULLIF(btrim(sm.vgv), ''), c.intended_value)),
  ROUND(public.parse_brl_numeric(COALESCE(NULLIF(btrim(sm.vgv), ''), c.intended_value)) * 0.018 * 0.86, 2),
  COALESCE(c.closed_at, sm.created_at, now())
FROM public.sales_mirrors sm
JOIN public.clients c ON c.id = sm.client_id
LEFT JOIN public.profiles p ON p.id = c.owner_id
WHERE c.stage = 'Concluído'
ON CONFLICT (client_id) DO NOTHING;

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
    AND directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
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
    AND directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
  )
)
WITH CHECK (
  public.app_current_user_role() = 'ADMIN'
  OR (
    public.app_current_user_role() = 'DIRETOR'
    AND directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
  )
);

GRANT SELECT, UPDATE ON TABLE public.commission_entries TO authenticated;
GRANT ALL ON TABLE public.commission_entries TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_user_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_dir uuid;
  v_target record;
  v_phone text;
BEGIN
  v_role := public.app_current_user_role();
  v_dir := public.app_current_user_directorate_id();

  IF v_role NOT IN ('ADMIN', 'DIRETOR') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT
    p.id,
    p.name,
    p.role,
    p.status,
    p.avatar_url,
    p.cpf,
    p.phone,
    p.address_cep,
    p.address_street,
    p.address_number,
    p.address_complement,
    p.address_neighborhood,
    p.address_city,
    p.address_state,
    p.emergency_name,
    p.emergency_phone,
    p.emergency_relation,
    p.team_id,
    p.coordinator_id,
    p.directorate_id,
    t.name AS team_name,
    coord.name AS coordinator_name,
    d.name AS directorate_name,
    u.email,
    u.created_at AS joined_at
  INTO v_target
  FROM public.profiles p
  LEFT JOIN public.teams t ON t.id = p.team_id
  LEFT JOIN public.profiles coord ON coord.id = p.coordinator_id
  LEFT JOIN public.directorates d ON d.id = p.directorate_id
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found';
  END IF;

  IF v_role = 'DIRETOR' AND v_target.directorate_id IS DISTINCT FROM v_dir THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  v_phone := NULLIF(btrim(v_target.phone), '');
  IF v_phone IS NULL THEN
    BEGIN
      EXECUTE 'SELECT NULLIF(btrim(telefone), '''') FROM public.profiles WHERE id = $1'
        INTO v_phone
        USING p_user_id;
    EXCEPTION
      WHEN undefined_column THEN
        v_phone := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'id', v_target.id,
    'name', v_target.name,
    'role', v_target.role,
    'status', v_target.status,
    'avatar_url', v_target.avatar_url,
    'cpf', v_target.cpf,
    'email', v_target.email,
    'phone', v_phone,
    'joined_at', v_target.joined_at,
    'address_cep', v_target.address_cep,
    'address_street', v_target.address_street,
    'address_number', v_target.address_number,
    'address_complement', v_target.address_complement,
    'address_neighborhood', v_target.address_neighborhood,
    'address_city', v_target.address_city,
    'address_state', v_target.address_state,
    'emergency_name', v_target.emergency_name,
    'emergency_phone', v_target.emergency_phone,
    'emergency_relation', v_target.emergency_relation,
    'team_id', v_target.team_id,
    'team_name', v_target.team_name,
    'coordinator_id', v_target.coordinator_id,
    'coordinator_name', v_target.coordinator_name,
    'directorate_id', v_target.directorate_id,
    'directorate_name', v_target.directorate_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_profile(uuid) TO authenticated, service_role;
