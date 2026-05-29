-- Repair Sauti AI workspace tables if an older migration was marked applied
-- before PostgREST saw the objects.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.ai_conversations (
  id text primary key,
  owner_kind text not null default 'staff' check (owner_kind in ('staff', 'member', 'system')),
  owner_id text,
  title text not null default 'New SautiAI chat',
  folder text,
  pinned boolean not null default false,
  mode text not null default 'chat' check (mode in ('chat', 'call', 'research', 'file', 'agent')),
  agent_key text,
  visibility text not null default 'private' check (visibility in ('private', 'team', 'organization')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_messages (
  id text primary key,
  conversation_id text not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null default '',
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_memories (
  id text primary key,
  owner_kind text not null default 'staff' check (owner_kind in ('staff', 'member', 'system', 'organization')),
  owner_id text,
  memory_type text not null default 'user' check (memory_type in ('user', 'operational', 'contextual', 'governance')),
  scope text not null default 'private' check (scope in ('private', 'team', 'organization', 'member')),
  source text not null default 'manual',
  content text not null,
  tags text[] not null default '{}'::text[],
  confidence numeric(4,3) not null default 0.700,
  approved boolean not null default false,
  approved_by text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_observations (
  id text primary key,
  observation_type text not null default 'workflow',
  title text not null,
  detail text not null default '',
  severity text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  entity_type text,
  entity_id text,
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed', 'actioned')),
  confidence numeric(4,3) not null default 0.700,
  created_by text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_files (
  id text primary key,
  owner_kind text not null default 'staff' check (owner_kind in ('staff', 'member', 'system', 'organization')),
  owner_id text,
  filename text not null,
  mime_type text,
  size_bytes bigint not null default 0,
  text_content text,
  summary text,
  tags text[] not null default '{}'::text[],
  status text not null default 'uploaded' check (status in ('uploaded', 'processed', 'failed')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_research_logs (
  id text primary key,
  query text not null,
  source_url text,
  source_title text,
  summary text not null default '',
  trusted boolean not null default false,
  requested_by text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_agents (
  key text primary key,
  name text not null,
  description text not null default '',
  domain text not null default 'operations',
  enabled boolean not null default true,
  system_prompt text not null default '',
  tools text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_call_sessions (
  id text primary key,
  owner_kind text not null default 'staff' check (owner_kind in ('staff', 'member', 'system')),
  owner_id text,
  conversation_id text references public.ai_conversations(id) on delete set null,
  mode text not null default 'audio' check (mode in ('audio', 'video', 'screen')),
  status text not null default 'active' check (status in ('active', 'ended')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  transcript jsonb not null default '[]'::jsonb,
  scene_notes jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_file_chunks (
  id text primary key,
  file_id text not null references public.ai_files(id) on delete cascade,
  chunk_index integer not null default 0,
  content text not null default '',
  summary text,
  tags text[] not null default '{}'::text[],
  embedding jsonb,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (file_id, chunk_index)
);

create table if not exists public.ai_knowledge_links (
  id text primary key,
  source_type text not null,
  source_id text not null,
  target_type text not null,
  target_id text not null,
  relation text not null default 'related',
  confidence numeric(4,3) not null default 0.700,
  created_by text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.ai_tool_permissions (
  id text primary key,
  tool_key text not null,
  role text not null default 'staff',
  enabled boolean not null default false,
  requires_approval boolean not null default true,
  approved_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (tool_key, role)
);

create table if not exists public.ai_realtime_events (
  id text primary key,
  conversation_id text references public.ai_conversations(id) on delete set null,
  call_session_id text references public.ai_call_sessions(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists ai_conversations_owner_idx on public.ai_conversations(owner_kind, owner_id, updated_at desc);
create index if not exists ai_messages_conversation_idx on public.ai_messages(conversation_id, created_at);
create index if not exists ai_memories_owner_idx on public.ai_memories(owner_kind, owner_id, memory_type, updated_at desc);
create index if not exists ai_files_owner_idx on public.ai_files(owner_kind, owner_id, created_at desc);
create index if not exists ai_file_chunks_file_idx on public.ai_file_chunks(file_id, chunk_index);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_memories enable row level security;
alter table public.ai_observations enable row level security;
alter table public.ai_files enable row level security;
alter table public.ai_research_logs enable row level security;
alter table public.ai_agents enable row level security;
alter table public.ai_call_sessions enable row level security;
alter table public.ai_file_chunks enable row level security;
alter table public.ai_knowledge_links enable row level security;
alter table public.ai_tool_permissions enable row level security;
alter table public.ai_realtime_events enable row level security;

drop policy if exists "Authenticated users read enabled AI agents" on public.ai_agents;
create policy "Authenticated users read enabled AI agents"
on public.ai_agents for select
to authenticated
using (enabled = true);

insert into public.ai_agents (key, name, description, domain, system_prompt, tools)
values
  ('finance', 'Finance Assistant', 'Loan, savings, shares, dockets, repayment, penalty, and reconciliation intelligence.', 'finance', 'Focus on financial accuracy, ledger evidence, loan cycles, repayment logic, and audit-safe recommendations.', array['ledger_read', 'loan_analysis', 'docket_analysis']),
  ('customer_support', 'Customer Support Assistant', 'Member service, support triage, letters, policies, and plain-language explanations.', 'support', 'Focus on warm support, member privacy, clear escalation, and accurate portal guidance.', array['support_threads', 'memo_polish']),
  ('technical_support', 'Technical Support AI', 'System diagnostics, callback errors, integrations, configuration, and workflow troubleshooting.', 'technical', 'Focus on system evidence, reproducible diagnostics, and careful change recommendations.', array['audit_log', 'callback_errors']),
  ('operations', 'Operations AI', 'Daily operations, approvals, staff workflow, field visits, suppliers, fuel, stock, and service wallets.', 'operations', 'Focus on operational bottlenecks, approvals, supplier fulfillment, service wallets, and field execution.', array['approvals', 'suppliers', 'stock']),
  ('hr', 'HR AI', 'Attendance, payroll support, staff patterns, and internal communication.', 'hr', 'Focus on privacy-aware staff support, attendance patterns, and internal communication clarity.', array['attendance', 'payroll']),
  ('developer', 'Developer Assistant', 'Product architecture, bugs, data model, guardrails, and implementation planning.', 'engineering', 'Focus on architecture, safe database changes, regression risk, and implementation sequencing.', array['schema_read', 'audit_log']),
  ('analytics', 'Analytics AI', 'Reports, anomaly detection, trend discovery, and management intelligence.', 'analytics', 'Focus on trends, anomalies, summaries, and decision-ready management insight.', array['reports', 'semantic_search'])
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  domain = excluded.domain,
  system_prompt = excluded.system_prompt,
  tools = excluded.tools,
  enabled = true,
  updated_at = now();

notify pgrst, 'reload schema';
