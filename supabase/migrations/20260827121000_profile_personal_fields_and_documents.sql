-- Dados pessoais do colaborador (preenchidos em Configurações)
-- + documentos de perfil visíveis somente para ADMIN

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS address_cep text,
  ADD COLUMN IF NOT EXISTS address_street text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_complement text,
  ADD COLUMN IF NOT EXISTS address_neighborhood text,
  ADD COLUMN IF NOT EXISTS address_city text,
  ADD COLUMN IF NOT EXISTS address_state text,
  ADD COLUMN IF NOT EXISTS emergency_name text,
  ADD COLUMN IF NOT EXISTS emergency_phone text,
  ADD COLUMN IF NOT EXISTS emergency_relation text;

-- Produção legada pode ter `telefone`; espelha para `phone` se phone estiver vazio
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'telefone'
  ) THEN
    UPDATE public.profiles
    SET phone = telefone
    WHERE (phone IS NULL OR btrim(phone) = '')
      AND telefone IS NOT NULL
      AND btrim(telefone) <> '';
  END IF;
END $$;

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

CREATE TABLE IF NOT EXISTS public.profile_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profile_documents_profile_idx
  ON public.profile_documents (profile_id, created_at DESC);

ALTER TABLE public.profile_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profile_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profile_documents_admin_all ON public.profile_documents;
CREATE POLICY profile_documents_admin_all
ON public.profile_documents
FOR ALL
TO authenticated
USING (public.app_current_user_role() = 'ADMIN')
WITH CHECK (public.app_current_user_role() = 'ADMIN');

REVOKE ALL ON TABLE public.profile_documents FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profile_documents TO authenticated;
GRANT ALL ON TABLE public.profile_documents TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
SELECT
  'profile-documents',
  'profile-documents',
  false,
  20971520,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
WHERE NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'profile-documents');

DROP POLICY IF EXISTS profile_documents_storage_admin_select ON storage.objects;
CREATE POLICY profile_documents_storage_admin_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'profile-documents'
  AND public.app_current_user_role() = 'ADMIN'
);

DROP POLICY IF EXISTS profile_documents_storage_admin_insert ON storage.objects;
CREATE POLICY profile_documents_storage_admin_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'profile-documents'
  AND public.app_current_user_role() = 'ADMIN'
);

DROP POLICY IF EXISTS profile_documents_storage_admin_update ON storage.objects;
CREATE POLICY profile_documents_storage_admin_update
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'profile-documents'
  AND public.app_current_user_role() = 'ADMIN'
)
WITH CHECK (
  bucket_id = 'profile-documents'
  AND public.app_current_user_role() = 'ADMIN'
);

DROP POLICY IF EXISTS profile_documents_storage_admin_delete ON storage.objects;
CREATE POLICY profile_documents_storage_admin_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'profile-documents'
  AND public.app_current_user_role() = 'ADMIN'
);
