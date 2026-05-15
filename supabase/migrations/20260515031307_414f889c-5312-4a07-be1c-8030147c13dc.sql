
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  actor_id text,
  actor_name text,
  actor_role text,
  action text not null,
  target_type text,
  target_id text,
  summary text not null,
  details jsonb,
  ip text,
  user_agent text
);
create index if not exists audit_log_ts_idx on public.audit_log (ts desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id);
create index if not exists audit_log_action_idx on public.audit_log (action);
create index if not exists audit_log_target_idx on public.audit_log (target_type, target_id);
alter table public.audit_log enable row level security;

create table if not exists public.idempotency_keys (
  key text primary key,
  scope text not null,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idempotency_keys_created_idx on public.idempotency_keys (created_at);
alter table public.idempotency_keys enable row level security;
