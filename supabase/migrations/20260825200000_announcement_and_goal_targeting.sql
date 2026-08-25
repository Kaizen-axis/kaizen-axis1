-- Announcement targeting (All / Directorate / Team / User)
-- Goal visibility + notifications for Directorate assignee and Coordinator
-- Preserve existing mission rows; new notifications always use type 'meta'

-- ── Announcements: explicit assignee ─────────────────────────────────────────
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS assignee_type text,
  ADD COLUMN IF NOT EXISTS assignee_id uuid;

UPDATE public.announcements
SET assignee_type = CASE
  WHEN directorate_id IS NULL THEN 'All'
  ELSE 'Directorate'
END
WHERE assignee_type IS NULL OR btrim(assignee_type) = '';

UPDATE public.announcements
SET assignee_id = directorate_id
WHERE assignee_type = 'Directorate'
  AND assignee_id IS NULL
  AND directorate_id IS NOT NULL;

ALTER TABLE public.announcements
  ALTER COLUMN assignee_type SET DEFAULT 'All';

UPDATE public.announcements SET assignee_type = 'All' WHERE assignee_type IS NULL;
ALTER TABLE public.announcements ALTER COLUMN assignee_type SET NOT NULL;

-- ── Notifications: announcements ─────────────────────────────────────────────
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

-- ── Notifications: goals (Coordinator + always type meta) ────────────────────
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
      'Nova Meta Global: ' || NEW.title,
      'Objetivo: ' || COALESCE(NEW.target::text, ''),
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
      'Objetivo: ' || COALESCE(NEW.target::text, ''),
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
      'Objetivo: ' || COALESCE(NEW.target::text, ''),
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
      'Objetivo: ' || COALESCE(NEW.target::text, ''),
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
      'Objetivo: ' || COALESCE(NEW.target::text, ''),
      'meta',
      NEW.assignee_id,
      NEW.id,
      '/'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_new_goal ON public.goals;
CREATE TRIGGER trigger_notify_new_goal
AFTER INSERT ON public.goals
FOR EACH ROW
EXECUTE FUNCTION public.notify_new_goal();

-- ── RLS: announcements + goals (column-safe) ────────────────────────────────
DO $$
DECLARE
  pol record;
  has_col boolean;
  ann_select text;
  goals_select text;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('announcements', 'goals')
      AND policyname IN (
        'announcements_select_scoped',
        'announcements_insert_strategic',
        'announcements_update_strategic',
        'announcements_delete_strategic',
        'goals_select_scoped'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname,
      CASE WHEN pol.policyname LIKE 'announcements%' THEN 'announcements' ELSE 'goals' END);
  END LOOP;

  ann_select :=
    'auth.uid() IS NOT NULL AND ('
    || 'public.app_current_user_role() = ''ADMIN'' OR '
    || 'COALESCE(assignee_type, ''All'') IN (''All'', ''Global'') OR '
    || '(assignee_type IN (''User'', ''individual'') AND assignee_id::text = auth.uid()::text) OR '
    || '(assignee_type IN (''Team'', ''team'', ''Equipe'') AND ('
    || 'assignee_id::text = public.app_current_user_team_id()::text OR '
    || 'assignee_id::text = public.app_current_user_team())) OR '
    || '(assignee_type IN (''Directorate'', ''Diretoria'', ''directorate'') AND assignee_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()) OR '
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

  EXECUTE $pol$
    CREATE POLICY announcements_insert_strategic
    ON public.announcements FOR INSERT TO authenticated
    WITH CHECK (
      auth.uid() IS NOT NULL
      AND public.app_current_user_role() IN ('ADMIN', 'DIRETOR')
      AND (
        public.app_current_user_role() = 'ADMIN'
        OR directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
      )
    )
  $pol$;

  EXECUTE $pol$
    CREATE POLICY announcements_update_strategic
    ON public.announcements FOR UPDATE TO authenticated
    USING (
      auth.uid() IS NOT NULL
      AND public.app_current_user_role() IN ('ADMIN', 'DIRETOR')
      AND (
        public.app_current_user_role() = 'ADMIN'
        OR directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
      )
    )
    WITH CHECK (
      auth.uid() IS NOT NULL
      AND public.app_current_user_role() IN ('ADMIN', 'DIRETOR')
      AND (
        public.app_current_user_role() = 'ADMIN'
        OR directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
      )
    )
  $pol$;

  EXECUTE $pol$
    CREATE POLICY announcements_delete_strategic
    ON public.announcements FOR DELETE TO authenticated
    USING (
      auth.uid() IS NOT NULL
      AND public.app_current_user_role() IN ('ADMIN', 'DIRETOR')
      AND (
        public.app_current_user_role() = 'ADMIN'
        OR directorate_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()
      )
    )
  $pol$;

  goals_select :=
    'auth.uid() IS NOT NULL AND ('
    || 'public.app_current_user_role() IN (''ADMIN'',''DIRETOR'') OR '
    || 'COALESCE(assignee_type, ''All'') IN (''All'', ''Global'') OR '
    || '(assignee_type IN (''User'', ''individual'') AND assignee_id::text = auth.uid()::text) OR '
    || '(assignee_type IN (''Team'', ''team'', ''Equipe'') AND ('
    || 'assignee_id::text = public.app_current_user_team_id()::text OR '
    || 'assignee_id::text = public.app_current_user_team())) OR '
    || '(assignee_type IN (''Directorate'', ''Diretoria'', ''directorate'') AND assignee_id IS NOT DISTINCT FROM public.app_current_user_directorate_id()) OR '
    || '(assignee_type IN (''Coordinator'', ''Coordenacao'', ''coordinator'') AND ('
    || 'assignee_id::text = auth.uid()::text OR assignee_id IS NOT DISTINCT FROM public.app_current_user_coordinator_id()))';

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'goals' AND column_name = 'owner_id'
  ) THEN
    goals_select := goals_select || ' OR owner_id = auth.uid()';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'goals' AND column_name = 'created_by'
  ) THEN
    goals_select := goals_select || ' OR created_by = auth.uid()';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'goals' AND column_name = 'user_id'
  ) THEN
    goals_select := goals_select || ' OR user_id = auth.uid()';
  END IF;

  goals_select := goals_select || ')';

  EXECUTE format(
    'CREATE POLICY goals_select_scoped ON public.goals FOR SELECT TO authenticated USING (%s)',
    goals_select
  );
END $$;

-- ── Gamification: Coordinator goals ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_gamification_from_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_already_processed BOOLEAN;
    v_streak_record     public.sales_streaks%ROWTYPE;
    v_today             DATE := CURRENT_DATE;
    v_days_diff         INT;
    v_affected_goal     RECORD;
    v_dev_id            UUID;
    v_contract_value    NUMERIC(15,2);
    v_user_id           UUID;
    v_is_sale           BOOLEAN := FALSE;
    v_is_approved       BOOLEAN := FALSE;
    v_goal_xp           INT;
    v_team_member_id    UUID;
    v_event_type        text;
BEGIN
    IF NEW.stage IN ('Concluído', 'Concluida', 'Venda Concluída') THEN
        v_is_sale := TRUE;
    ELSIF NEW.stage = 'Aprovado' THEN
        IF TG_OP = 'INSERT' OR COALESCE(OLD.stage, '') != 'Aprovado' THEN
            v_is_approved := TRUE;
        END IF;
    END IF;

    IF NOT v_is_sale AND NOT v_is_approved THEN RETURN NEW; END IF;

    v_user_id := COALESCE(NEW.owner_id, NEW.user_id);

    BEGIN
        v_contract_value := COALESCE(REPLACE(REPLACE(NEW.intended_value, '.', ''), ',', '.')::numeric, 0);
    EXCEPTION WHEN OTHERS THEN
        v_contract_value := 0;
    END;

    SELECT id INTO v_dev_id FROM public.developments WHERE name = NEW.development LIMIT 1;

    IF v_is_sale THEN
        SELECT EXISTS(SELECT 1 FROM public.sales_events WHERE client_id = NEW.id) INTO v_already_processed;
        IF NOT v_already_processed THEN
            INSERT INTO public.sales_events (client_id, user_id, contract_value, development_id)
            VALUES (NEW.id, v_user_id, v_contract_value, v_dev_id);

            INSERT INTO public.system_events (type, user_id, payload)
            VALUES ('sale_completed', v_user_id, jsonb_build_object('client_id', NEW.id, 'value', v_contract_value));

            INSERT INTO public.user_points (user_id, points, source, reference_id)
            VALUES (v_user_id, 500, 'sale', NEW.id);

            SELECT * INTO v_streak_record FROM public.sales_streaks WHERE user_id = v_user_id;
            IF NOT FOUND THEN
                INSERT INTO public.sales_streaks (user_id, current_streak, longest_streak, last_sale_date)
                VALUES (v_user_id, 1, 1, v_today);
            ELSE
                v_days_diff := v_today - v_streak_record.last_sale_date;
                IF v_days_diff = 1 THEN
                    UPDATE public.sales_streaks
                    SET current_streak = current_streak + 1,
                        longest_streak = GREATEST(longest_streak, current_streak + 1),
                        last_sale_date = v_today
                    WHERE user_id = v_user_id;
                ELSIF v_days_diff > 1 THEN
                    UPDATE public.sales_streaks
                    SET current_streak = 1, last_sale_date = v_today
                    WHERE user_id = v_user_id;
                END IF;
            END IF;

            PERFORM public.check_user_achievements(v_user_id);
        END IF;
    END IF;

    IF v_is_approved THEN
        SELECT EXISTS(SELECT 1 FROM public.approved_events WHERE client_id = NEW.id) INTO v_already_processed;
        IF NOT v_already_processed THEN
            INSERT INTO public.approved_events (client_id, user_id, development_id)
            VALUES (NEW.id, v_user_id, v_dev_id);
            PERFORM public.check_user_achievements(v_user_id);
        ELSE
            RETURN NEW;
        END IF;
    END IF;

    FOR v_affected_goal IN
        SELECT * FROM public.goals
        WHERE status = 'active'
        AND (
            assignee_type = 'All' OR
            (assignee_type = 'User' AND assignee_id = v_user_id) OR
            (assignee_type = 'Team' AND assignee_id IN (
                SELECT team_id FROM public.profiles WHERE id = v_user_id AND team_id IS NOT NULL
            )) OR
            (assignee_type = 'Directorate' AND assignee_id IN (
                SELECT directorate_id FROM public.profiles WHERE id = v_user_id AND directorate_id IS NOT NULL
            )) OR
            (assignee_type = 'Coordinator' AND (
                assignee_id = v_user_id
                OR assignee_id IN (
                    SELECT coordinator_id FROM public.profiles WHERE id = v_user_id AND coordinator_id IS NOT NULL
                )
            ))
        )
        AND (property_id = v_dev_id OR property_id IS NULL)
    LOOP
        IF (v_is_sale AND (v_affected_goal.objective_type IS NULL OR v_affected_goal.objective_type = 'sales')) OR
           (v_is_approved AND v_affected_goal.objective_type = 'approved_clients') THEN

            UPDATE public.goals
            SET current_progress = current_progress +
                CASE WHEN v_affected_goal.measure_type = 'currency' THEN v_contract_value ELSE 1 END
            WHERE id = v_affected_goal.id
            RETURNING * INTO v_affected_goal;

            IF v_affected_goal.current_progress >= v_affected_goal.target AND v_affected_goal.status = 'active' THEN
                v_goal_xp := COALESCE(v_affected_goal.points, 300);
                v_event_type := CASE WHEN v_affected_goal.type = 'Missão' THEN 'mission_completed' ELSE 'goal_achieved' END;

                IF v_affected_goal.assignee_type = 'Team' THEN
                    FOR v_team_member_id IN
                        SELECT id FROM public.profiles
                        WHERE team_id = v_affected_goal.assignee_id
                          AND UPPER(COALESCE(status, '')) IN ('ACTIVE', 'ATIVO')
                    LOOP
                        INSERT INTO public.user_points (user_id, points, source, reference_id)
                        VALUES (v_team_member_id, v_goal_xp, v_affected_goal.type, v_affected_goal.id);

                        INSERT INTO public.system_events (type, user_id, payload)
                        VALUES (
                            v_event_type,
                            v_team_member_id,
                            jsonb_build_object('goal_id', v_affected_goal.id, 'title', v_affected_goal.title, 'xp', v_goal_xp)
                        );
                        PERFORM public.check_user_achievements(v_team_member_id);
                    END LOOP;

                ELSIF v_affected_goal.assignee_type = 'Directorate' THEN
                    FOR v_team_member_id IN
                        SELECT id FROM public.profiles
                        WHERE directorate_id = v_affected_goal.assignee_id
                          AND UPPER(COALESCE(status, '')) IN ('ACTIVE', 'ATIVO')
                    LOOP
                        INSERT INTO public.user_points (user_id, points, source, reference_id)
                        VALUES (v_team_member_id, v_goal_xp, v_affected_goal.type, v_affected_goal.id);

                        INSERT INTO public.system_events (type, user_id, payload)
                        VALUES (
                            v_event_type,
                            v_team_member_id,
                            jsonb_build_object('goal_id', v_affected_goal.id, 'title', v_affected_goal.title, 'xp', v_goal_xp)
                        );
                        PERFORM public.check_user_achievements(v_team_member_id);
                    END LOOP;

                ELSIF v_affected_goal.assignee_type = 'Coordinator' THEN
                    FOR v_team_member_id IN
                        SELECT id FROM public.profiles
                        WHERE (
                            id = v_affected_goal.assignee_id
                            OR coordinator_id = v_affected_goal.assignee_id
                          )
                          AND UPPER(COALESCE(status, '')) IN ('ACTIVE', 'ATIVO')
                    LOOP
                        INSERT INTO public.user_points (user_id, points, source, reference_id)
                        VALUES (v_team_member_id, v_goal_xp, v_affected_goal.type, v_affected_goal.id);

                        INSERT INTO public.system_events (type, user_id, payload)
                        VALUES (
                            v_event_type,
                            v_team_member_id,
                            jsonb_build_object('goal_id', v_affected_goal.id, 'title', v_affected_goal.title, 'xp', v_goal_xp)
                        );
                        PERFORM public.check_user_achievements(v_team_member_id);
                    END LOOP;

                ELSE
                    INSERT INTO public.user_points (user_id, points, source, reference_id)
                    VALUES (v_user_id, v_goal_xp, v_affected_goal.type, v_affected_goal.id);

                    INSERT INTO public.system_events (type, user_id, payload)
                    VALUES (
                        v_event_type,
                        v_user_id,
                        jsonb_build_object('goal_id', v_affected_goal.id, 'title', v_affected_goal.title, 'xp', v_goal_xp)
                    );
                    PERFORM public.check_user_achievements(v_user_id);
                END IF;

                UPDATE public.goals SET status = 'achieved', closed_at = NOW() WHERE id = v_affected_goal.id;
            END IF;
        END IF;
    END LOOP;

    RETURN NEW;
END;
$$;
