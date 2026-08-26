-- Soft-archive for tasks: hidden from active lists, recoverable via Arquivadas.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON public.tasks(archived_at);
