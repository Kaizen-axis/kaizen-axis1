-- Corrige o trigger (undefined_schema não existe no Postgres) e passa a ler
-- URL/chave de push_dispatch_config — o SQL Editor consegue INSERT nela.
-- ALTER DATABASE SET app.settings.* é bloqueado no Supabase hosted.

CREATE TABLE IF NOT EXISTS public.push_dispatch_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  supabase_url text NOT NULL,
  service_role_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.push_dispatch_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_dispatch_config FORCE ROW LEVEL SECURITY;

GRANT ALL ON public.push_dispatch_config TO service_role;

DROP POLICY IF EXISTS push_dispatch_config_owner ON public.push_dispatch_config;
CREATE POLICY push_dispatch_config_owner
ON public.push_dispatch_config
FOR ALL
TO postgres
USING (true)
WITH CHECK (true);

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
  BEGIN
    SELECT NULLIF(btrim(c.supabase_url), ''), NULLIF(btrim(c.service_role_key), '')
    INTO base_url, service_key
    FROM public.push_dispatch_config c
    WHERE c.id = 1;
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  IF base_url IS NULL THEN
    base_url := NULLIF(btrim(current_setting('app.settings.supabase_url', true)), '');
  END IF;
  IF service_key IS NULL THEN
    service_key := NULLIF(btrim(current_setting('app.settings.service_role_key', true)), '');
  END IF;

  BEGIN
    IF base_url IS NULL THEN
      SELECT decrypted_secret INTO base_url
      FROM vault.decrypted_secrets
      WHERE name IN ('supabase_url', 'SUPABASE_URL')
      LIMIT 1;
    END IF;
  EXCEPTION WHEN undefined_table OR insufficient_privilege OR invalid_schema_name THEN
    NULL;
  END;

  BEGIN
    IF service_key IS NULL THEN
      SELECT decrypted_secret INTO service_key
      FROM vault.decrypted_secrets
      WHERE name IN ('service_role_key', 'SUPABASE_SERVICE_ROLE_KEY')
      LIMIT 1;
    END IF;
  EXCEPTION WHEN undefined_table OR insufficient_privilege OR invalid_schema_name THEN
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
  EXCEPTION WHEN OTHERS THEN
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
