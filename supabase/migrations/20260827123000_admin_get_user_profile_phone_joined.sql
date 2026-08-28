-- RPC de perfil: COALESCE phone/telefone legado + joined_at em auth.users.created_at.
-- Idempotente (CREATE OR REPLACE) para bancos que já rodaram a 22000.

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
