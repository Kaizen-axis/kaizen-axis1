-- Permanent delete for inactive users: remove login/profile, keep business history.

-- Keep presence rows after the auth user is gone.
DO $$
DECLARE
  r record;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'daily_checkins' AND column_name = 'user_id'
  ) THEN
    BEGIN
      ALTER TABLE public.daily_checkins ALTER COLUMN user_id DROP NOT NULL;
    EXCEPTION WHEN others THEN
      NULL;
    END;

    FOR r IN
      SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public'
        AND rel.relname = 'daily_checkins'
        AND con.contype = 'f'
        AND pg_get_constraintdef(con.oid) ILIKE '%user_id%'
    LOOP
      EXECUTE format('ALTER TABLE public.daily_checkins DROP CONSTRAINT IF EXISTS %I', r.conname);
    END LOOP;

    ALTER TABLE public.daily_checkins
      ADD CONSTRAINT daily_checkins_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.delete_user_permanently(UUID);

CREATE OR REPLACE FUNCTION public.delete_user_permanently(user_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         UUID := user_id;
  deleted_count INTEGER := 0;
  user_email    TEXT;
  user_name     TEXT;
  user_status   TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN') THEN
    RAISE EXCEPTION 'Apenas ADMIN pode excluir usuários permanentemente';
  END IF;

  IF v_uid = auth.uid() THEN
    RAISE EXCEPTION 'Você não pode excluir sua própria conta';
  END IF;

  SELECT name, status INTO user_name, user_status FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuário não encontrado';
  END IF;

  IF lower(coalesce(user_status, '')) NOT IN ('inactive', 'inativo') THEN
    RAISE EXCEPTION 'Só é possível excluir permanentemente usuários inativos';
  END IF;

  SELECT email INTO user_email FROM auth.users WHERE id = v_uid;

  -- Unlink business history (do not delete wallet/sales/presence)
  BEGIN UPDATE public.clients SET owner_id = NULL WHERE owner_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.clients SET user_id = NULL WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.appointments SET owner_id = NULL WHERE owner_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.appointments SET user_id = NULL WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.tasks SET owner_id = NULL WHERE owner_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.tasks SET assigned_to = NULL WHERE assigned_to = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.tasks SET created_by = NULL WHERE created_by = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.tasks SET user_id = NULL WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.leads SET assigned_to = NULL WHERE assigned_to = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.lead_assignments SET corretor_id = NULL WHERE corretor_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.goals SET created_by = NULL WHERE created_by = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.goals SET owner_id = NULL WHERE owner_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.goals SET user_id = NULL WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.goals SET assignee_id = NULL WHERE assignee_type IN ('User', 'individual') AND assignee_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN UPDATE public.announcements SET author_id = NULL WHERE author_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.announcements SET owner_id = NULL WHERE owner_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.directorates SET manager_id = NULL WHERE manager_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN UPDATE public.teams SET manager_id = NULL WHERE manager_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN UPDATE public.teams SET members = array_remove(members, v_uid) WHERE members IS NOT NULL AND v_uid = ANY (members); EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN UPDATE public.profiles SET manager_id = NULL WHERE manager_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN UPDATE public.profiles SET coordinator_id = NULL WHERE coordinator_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN UPDATE public.presence_queue SET last_assigned_corretor_id = NULL WHERE last_assigned_corretor_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN UPDATE public.daily_checkins SET user_id = NULL WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.sales_events SET user_id = NULL WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.approved_events SET user_id = NULL WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.system_events SET user_id = NULL WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.developments SET user_id = NULL WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.trainings SET created_by = NULL WHERE created_by = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.client_documents SET uploaded_by = NULL WHERE uploaded_by = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.portals SET created_by = NULL WHERE created_by = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN NULL; END;
  BEGIN UPDATE public.chat_messages SET sender_id = NULL WHERE sender_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN
    BEGIN DELETE FROM public.chat_messages WHERE sender_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  END;
  BEGIN UPDATE public.chat_messages SET receiver_id = NULL WHERE receiver_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column OR not_null_violation THEN
    BEGIN DELETE FROM public.chat_messages WHERE receiver_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  END;

  -- Personal/access rows that would block profile/auth delete
  BEGIN DELETE FROM public.notifications WHERE target_user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.push_subscriptions WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.user_achievements WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.user_points WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.checkin_tokens WHERE corretor_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.training_completions WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.chat_group_members WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.chat_message_reactions WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.wa_conversations WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.sales_streaks WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;
  BEGIN DELETE FROM public.checkin_always_present_users WHERE user_id = v_uid; EXCEPTION WHEN undefined_table OR undefined_column THEN NULL; END;

  DELETE FROM public.profiles WHERE id = v_uid;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  DELETE FROM auth.users WHERE id = v_uid;

  RETURN json_build_object(
    'success', true,
    'message', 'Usuário excluído permanentemente. O histórico comercial foi preservado.',
    'user_id', v_uid,
    'user_name', user_name,
    'user_email', user_email,
    'deleted_count', deleted_count
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Erro ao excluir usuário: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_user_permanently(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_permanently(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_permanently(UUID) TO service_role;
