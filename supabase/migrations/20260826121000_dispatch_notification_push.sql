-- Disparo de Web Push no INSERT de notifications (pg_net) + log de deduplicação.
--
-- URL e chave: current_setting('app.settings.supabase_url' / 'app.settings.service_role_key')
-- ou secrets no Vault (supabase_url / service_role_key). Sem isso o trigger é no-op
-- e o send-notification ainda chama send-push internamente.

CREATE TABLE IF NOT EXISTS public.push_dispatch_log (
  notification_id UUID PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.push_dispatch_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_dispatch_log FORCE ROW LEVEL SECURITY;

GRANT ALL ON public.push_dispatch_log TO service_role;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net unavailable: %', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public.tg_notifications_dispatch_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, extensions
AS $$
DECLARE
  base_url text;
  service_key text;
  endpoint text;
BEGIN
  base_url := NULLIF(btrim(current_setting('app.settings.supabase_url', true)), '');
  service_key := NULLIF(btrim(current_setting('app.settings.service_role_key', true)), '');

  BEGIN
    IF base_url IS NULL THEN
      SELECT decrypted_secret INTO base_url
      FROM vault.decrypted_secrets
      WHERE name IN ('supabase_url', 'SUPABASE_URL')
      LIMIT 1;
    END IF;
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    IF service_key IS NULL THEN
      SELECT decrypted_secret INTO service_key
      FROM vault.decrypted_secrets
      WHERE name IN ('service_role_key', 'SUPABASE_SERVICE_ROLE_KEY')
      LIMIT 1;
    END IF;
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  IF base_url IS NULL OR service_key IS NULL THEN
    RETURN NEW;
  END IF;

  endpoint := rtrim(base_url, '/') || '/functions/v1/send-push';

  BEGIN
    PERFORM net.http_post(
      url := endpoint,
      body := jsonb_build_object(
        'type', TG_OP,
        'table', TG_TABLE_NAME,
        'record', to_jsonb(NEW)
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      timeout_milliseconds := 4000
    );
  EXCEPTION WHEN undefined_function OR undefined_schema THEN
    NULL;
  WHEN OTHERS THEN
    RAISE WARNING 'tg_notifications_dispatch_push: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notifications_dispatch_push ON public.notifications;
CREATE TRIGGER trg_notifications_dispatch_push
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.tg_notifications_dispatch_push();
