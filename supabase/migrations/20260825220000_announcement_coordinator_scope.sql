-- Coordinator targeting for announcements (notifications + RLS SELECT)
-- Mirrors goal targeting: the coordinator plus anyone with coordinator_id = assignee.

CREATE OR REPLACE FUNCTION public.notify_new_announcement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignee_type text;
BEGIN
  v_assignee_type := lower(coalesce(NEW.assignee_type, ''));

  IF v_assignee_type IN ('', 'all', 'global') OR (NEW.assignee_id IS NULL AND NEW.directorate_id IS NULL) THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    SELECT
      'Novo Aviso Global: ' || NEW.title,
      LEFT(COALESCE(NEW.content, ''), 100),
      'aviso',
      id,
      NEW.id,
      '/'
    FROM public.profiles
    WHERE lower(coalesce(status, '')) IN ('active', 'ativo');

  ELSIF v_assignee_type IN ('directorate', 'diretoria') AND NEW.assignee_id IS NOT NULL THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    SELECT
      'Novo Aviso na Diretoria: ' || NEW.title,
      LEFT(COALESCE(NEW.content, ''), 100),
      'aviso',
      id,
      NEW.id,
      '/'
    FROM public.profiles
    WHERE directorate_id::text = NEW.assignee_id::text
      AND lower(coalesce(status, '')) IN ('active', 'ativo');

  ELSIF v_assignee_type IN ('team', 'equipe') AND NEW.assignee_id IS NOT NULL THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    SELECT
      'Novo Aviso na Equipe: ' || NEW.title,
      LEFT(COALESCE(NEW.content, ''), 100),
      'aviso',
      id,
      NEW.id,
      '/'
    FROM public.profiles
    WHERE (
      team_id::text = NEW.assignee_id::text
      OR team = NEW.assignee_id::text
    )
      AND lower(coalesce(status, '')) IN ('active', 'ativo');

  ELSIF v_assignee_type IN ('coordinator', 'coordenacao', 'coordenator') AND NEW.assignee_id IS NOT NULL THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    SELECT
      'Novo Aviso na Coordenacao: ' || NEW.title,
      LEFT(COALESCE(NEW.content, ''), 100),
      'aviso',
      id,
      NEW.id,
      '/'
    FROM public.profiles
    WHERE (
      id::text = NEW.assignee_id::text
      OR coordinator_id::text = NEW.assignee_id::text
    )
      AND lower(coalesce(status, '')) IN ('active', 'ativo');

  ELSIF v_assignee_type IN ('user', 'individual') AND NEW.assignee_id IS NOT NULL THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    VALUES (
      'Novo Aviso para Voce: ' || NEW.title,
      LEFT(COALESCE(NEW.content, ''), 100),
      'aviso',
      NEW.assignee_id,
      NEW.id,
      '/'
    );
  ELSIF NEW.directorate_id IS NOT NULL THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    SELECT
      'Novo Aviso na Diretoria: ' || NEW.title,
      LEFT(COALESCE(NEW.content, ''), 100),
      'aviso',
      id,
      NEW.id,
      '/'
    FROM public.profiles
    WHERE directorate_id = NEW.directorate_id
      AND lower(coalesce(status, '')) IN ('active', 'ativo');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_new_announcement ON public.announcements;
CREATE TRIGGER trigger_notify_new_announcement
AFTER INSERT ON public.announcements
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_announcement();

DO $$
DECLARE
  has_col boolean;
  ann_select text;
BEGIN
  DROP POLICY IF EXISTS announcements_select_scoped ON public.announcements;

  ann_select :=
    'auth.uid() IS NOT NULL AND ('
    || 'public.app_current_user_role() = ''ADMIN'' OR '
    || 'COALESCE(assignee_type, ''All'') IN (''All'', ''Global'') OR '
    || '(assignee_type IN (''User'', ''individual'') AND assignee_id::text = auth.uid()::text) OR '
    || '(assignee_type IN (''Team'', ''team'', ''Equipe'') AND ('
    || 'assignee_id::text = public.app_current_user_team_id()::text OR '
    || 'assignee_id::text = public.app_current_user_team())) OR '
    || '(assignee_type IN (''Directorate'', ''Diretoria'', ''directorate'') AND assignee_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()) OR '
    || '(assignee_type IN (''Coordinator'', ''Coordenacao'', ''coordinator'') AND ('
    || 'assignee_id::text = auth.uid()::text OR assignee_id IS NOT DISTINCT FROM public.app_current_user_coordinator_id())) OR '
    || '(public.app_current_user_role() = ''DIRETOR'' AND directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id())';

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'announcements' AND column_name = 'author_id'
  ) INTO has_col;
  IF has_col THEN
    ann_select := ann_select || ' OR author_id = auth.uid()';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'announcements' AND column_name = 'owner_id'
  ) INTO has_col;
  IF has_col THEN
    ann_select := ann_select || ' OR owner_id = auth.uid()';
  END IF;

  ann_select := ann_select || ')';

  EXECUTE format(
    'CREATE POLICY announcements_select_scoped ON public.announcements FOR SELECT TO authenticated USING (%s)',
    ann_select
  );
END $$;
