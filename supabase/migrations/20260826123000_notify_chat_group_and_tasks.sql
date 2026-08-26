-- Colunas de targeting em announcements + notificações de chat em grupo,
-- tarefas, metas e anúncios.
-- Sem DROP TRIGGER / UPDATE na mesma transação: isso travava announcements
-- junto com chat_messages/tasks/goals e gerava deadlock com o PostgREST.

SET LOCAL lock_timeout = '8s';
SET LOCAL deadlock_timeout = '200ms';

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS assignee_type text DEFAULT 'All',
  ADD COLUMN IF NOT EXISTS assignee_id uuid;

-- ── Chat 1:1 + grupo ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_new_chat_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sender_name text;
  v_payload jsonb;
  v_receiver uuid;
  v_group uuid;
BEGIN
  v_payload := to_jsonb(NEW);
  v_receiver := NULLIF(v_payload->>'receiver_id', '')::uuid;
  v_group := NULLIF(v_payload->>'group_id', '')::uuid;

  SELECT name INTO v_sender_name FROM public.profiles WHERE id = NEW.sender_id;

  IF v_receiver IS NOT NULL THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    VALUES (
      'Nova Mensagem',
      COALESCE(v_sender_name, 'Alguém') || ': ' || LEFT(COALESCE(NEW.content, 'Arquivo/Mídia'), 50),
      'chat',
      v_receiver,
      NEW.id,
      '/chat'
    );
  ELSIF v_group IS NOT NULL THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    SELECT
      'Nova mensagem no grupo',
      COALESCE(v_sender_name, 'Alguém') || ': ' || LEFT(COALESCE(NEW.content, 'Arquivo/Mídia'), 50),
      'chat',
      m.user_id,
      v_group,
      '/chat'
    FROM public.chat_group_members m
    WHERE m.group_id = v_group
      AND m.user_id IS DISTINCT FROM NEW.sender_id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_notify_new_chat_message
AFTER INSERT ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_chat_message();

-- ── Tarefas atribuídas a outra pessoa ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_new_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_assigned uuid;
  v_creator uuid;
BEGIN
  v_payload := to_jsonb(NEW);
  v_assigned := NULLIF(v_payload->>'assigned_to', '')::uuid;
  v_creator := COALESCE(
    NULLIF(v_payload->>'created_by', '')::uuid,
    NULLIF(v_payload->>'owner_id', '')::uuid,
    NULLIF(v_payload->>'user_id', '')::uuid
  );

  IF v_assigned IS NULL OR v_assigned IS NOT DISTINCT FROM v_creator THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
  VALUES (
    'Nova tarefa',
    LEFT(COALESCE(NEW.title, 'Você recebeu uma nova tarefa'), 120),
    'tarefa',
    v_assigned,
    NEW.id,
    '/tasks'
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_notify_new_task
AFTER INSERT ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_task();

-- ── Anúncios ─────────────────────────────────────────────────────────────────
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
      'Novo Aviso: ' || NEW.title,
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

CREATE OR REPLACE TRIGGER trigger_notify_new_announcement
AFTER INSERT ON public.announcements
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_announcement();

-- ── Metas ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_new_goal()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignee_type text;
BEGIN
  v_assignee_type := lower(coalesce(NEW.assignee_type, ''));

  IF v_assignee_type IN ('global', 'all', '') THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    SELECT
      'Nova Meta: ' || NEW.title,
      LEFT(COALESCE(NEW.description, 'Objetivo: ' || COALESCE(NEW.target::text, '')), 120),
      'meta',
      id,
      NEW.id,
      '/'
    FROM public.profiles
    WHERE lower(coalesce(status, '')) IN ('active', 'ativo');

  ELSIF v_assignee_type IN ('directorate', 'diretoria') AND NEW.assignee_id IS NOT NULL THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    SELECT
      'Nova Meta para Diretoria: ' || NEW.title,
      LEFT(COALESCE(NEW.description, 'Objetivo: ' || COALESCE(NEW.target::text, '')), 120),
      'meta',
      id,
      NEW.id,
      '/'
    FROM public.profiles
    WHERE directorate_id::text = NEW.assignee_id::text
      AND lower(coalesce(status, '')) IN ('active', 'ativo');

  ELSIF v_assignee_type IN ('team', 'equipe') AND NEW.assignee_id IS NOT NULL THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    SELECT
      'Nova Meta para Equipe: ' || NEW.title,
      LEFT(COALESCE(NEW.description, 'Objetivo: ' || COALESCE(NEW.target::text, '')), 120),
      'meta',
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
      'Nova Meta para Coordenacao: ' || NEW.title,
      LEFT(COALESCE(NEW.description, 'Objetivo: ' || COALESCE(NEW.target::text, '')), 120),
      'meta',
      id,
      NEW.id,
      '/'
    FROM public.profiles
    WHERE (
      id::text = NEW.assignee_id::text
      OR coordinator_id::text = NEW.assignee_id::text
    )
      AND lower(coalesce(status, '')) IN ('active', 'ativo');

  ELSIF v_assignee_type IN ('individual', 'user') AND NEW.assignee_id IS NOT NULL THEN
    INSERT INTO public.notifications (title, message, type, target_user_id, reference_id, reference_route)
    VALUES (
      'Nova Meta Atribuida a Voce: ' || NEW.title,
      LEFT(COALESCE(NEW.description, 'Objetivo: ' || COALESCE(NEW.target::text, '')), 120),
      'meta',
      NEW.assignee_id,
      NEW.id,
      '/'
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_notify_new_goal
AFTER INSERT ON public.goals
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_goal();

NOTIFY pgrst, 'reload schema';
