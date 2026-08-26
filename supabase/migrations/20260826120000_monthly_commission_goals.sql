-- Meta mensal de comissão por usuário (card Progresso do Mês).

CREATE TABLE IF NOT EXISTS public.monthly_commission_goals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  year       INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month      INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  amount     NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, year, month)
);

CREATE INDEX IF NOT EXISTS monthly_commission_goals_user_idx
  ON public.monthly_commission_goals (user_id, year, month);

ALTER TABLE public.monthly_commission_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_commission_goals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS monthly_commission_goals_own ON public.monthly_commission_goals;
CREATE POLICY monthly_commission_goals_own
ON public.monthly_commission_goals
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_commission_goals TO authenticated;
GRANT ALL ON public.monthly_commission_goals TO service_role;
