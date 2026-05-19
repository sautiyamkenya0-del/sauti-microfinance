do $$
begin
  alter type public.penalty_status add value if not exists 'waived';
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter type public.penalty_source add value if not exists 'waiver';
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.legacy_import_sync_runs (
  id text primary key,
  source_table text not null default 'api_topup',
  fetched_rows integer not null default 0,
  upserted_rows integer not null default 0,
  applied_rows integer not null default 0,
  held_rows integer not null default 0,
  skipped_rows integer not null default 0,
  status text not null default 'success',
  note text,
  created_by text references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint legacy_import_sync_runs_status_check
    check (status in ('success', 'partial', 'error'))
);

alter table public.legacy_import_sync_runs enable row level security;
create index if not exists idx_legacy_import_sync_runs_created_at
  on public.legacy_import_sync_runs(created_at desc);

create table if not exists public.legacy_topup_imports (
  id text primary key,
  source_row_key text not null unique,
  source_table text not null default 'api_topup',
  source_created_at timestamptz,
  source_account text,
  source_member_hint text,
  source_payer_name text,
  source_phone text,
  source_amount numeric(14,2) not null default 0,
  source_ref text,
  raw jsonb not null default '{}'::jsonb,
  matched_member_id text references public.members(id) on delete set null,
  allocation_status text not null default 'pending',
  allocation_notes text[] not null default '{}'::text[],
  allocated_transaction_id text references public.transactions(id) on delete set null,
  allocated_at timestamptz,
  sync_run_id text references public.legacy_import_sync_runs(id) on delete set null,
  read_only boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint legacy_topup_imports_status_check
    check (allocation_status in ('pending', 'applied', 'held', 'error'))
);

alter table public.legacy_topup_imports enable row level security;
create index if not exists idx_legacy_topup_imports_status_created
  on public.legacy_topup_imports(allocation_status, created_at desc);
create index if not exists idx_legacy_topup_imports_member_created
  on public.legacy_topup_imports(matched_member_id, created_at desc);
create index if not exists idx_legacy_topup_imports_ref
  on public.legacy_topup_imports(source_ref);

create table if not exists public.member_carryover_profiles (
  member_id text primary key references public.members(id) on delete cascade,
  savings_balance numeric(14,2) not null default 0,
  share_units integer not null default 0,
  fees_paid_total numeric(14,2) not null default 0,
  loan_repayments_total numeric(14,2) not null default 0,
  investment_balance numeric(14,2) not null default 0,
  other_collected_total numeric(14,2) not null default 0,
  total_collected numeric(14,2) not null default 0,
  pending_balance numeric(14,2) not null default 0,
  penalties_outstanding numeric(14,2) not null default 0,
  penalties_waived_total numeric(14,2) not null default 0,
  membership_fee_paid boolean not null default false,
  card_fee_paid boolean not null default false,
  sticker_fee_paid boolean not null default false,
  first_upfront_paid boolean not null default false,
  completed_loan_cycles integer not null default 0,
  first_loan_start_date date,
  last_loan_end_date date,
  collection_breakdown jsonb not null default '{}'::jsonb,
  notes text,
  created_by text references public.staff(id) on delete set null,
  updated_by text references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.member_carryover_profiles enable row level security;
drop trigger if exists trg_member_carryover_profiles_updated_at on public.member_carryover_profiles;
create trigger trg_member_carryover_profiles_updated_at
before update on public.member_carryover_profiles
for each row execute function public.tg_set_updated_at();

create table if not exists public.member_carryover_loans (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  label text not null default 'Legacy loan',
  loan_cycle_number integer not null default 1,
  principal numeric(14,2) not null default 0,
  interest_rate_pct numeric(6,3) not null default 0,
  term_days integer not null,
  daily_savings_amount numeric(14,2) not null default 0,
  start_date date not null,
  due_date date,
  closed_on date,
  paid_to_date numeric(14,2) not null default 0,
  status text not null default 'active',
  finished boolean not null default false,
  penalty_waived_amount numeric(14,2) not null default 0,
  notes text,
  created_by text references public.staff(id) on delete set null,
  updated_by text references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_carryover_loans_status_check
    check (status in ('active', 'closed', 'defaulted')),
  constraint member_carryover_loans_term_days_check
    check (term_days in (7, 14, 30, 60, 90))
);

alter table public.member_carryover_loans enable row level security;
drop trigger if exists trg_member_carryover_loans_updated_at on public.member_carryover_loans;
create trigger trg_member_carryover_loans_updated_at
before update on public.member_carryover_loans
for each row execute function public.tg_set_updated_at();

create index if not exists idx_member_carryover_loans_member_start
  on public.member_carryover_loans(member_id, start_date desc);

create table if not exists public.report_snapshots (
  id text primary key,
  report_key text not null default 'reports',
  title text not null,
  period_start date not null,
  period_end date not null,
  filters jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  chart_data jsonb not null default '{}'::jsonb,
  generated_by text references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.report_snapshots enable row level security;
create index if not exists idx_report_snapshots_report_created
  on public.report_snapshots(report_key, created_at desc);
