CREATE TABLE public.runtime_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.runtime_secrets ENABLE ROW LEVEL SECURITY;
-- No policies = no client access. All reads/writes go through server fns using the service role.