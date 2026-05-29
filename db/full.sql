-- =====================================================================
-- Sauti Solute - FULL DATABASE MIGRATION ROLLUP
-- =====================================================================
-- Generated from supabase/migrations in timestamp order.
-- Run this file once against a fresh Supabase/Postgres database to
-- create the complete current schema and bootstrap data.
-- Keep this file in sync whenever a migration is added.
-- =====================================================================

-- =====================================================================
-- Migration: 20260514011542_42a6a25b-9bc5-4ec7-ab13-6651ac8ad4b9.sql
-- =====================================================================

-- Initial schema for Sauti Microfinance (matches db/full.sql)
create extension if not exists "pgcrypto";

do $$ begin create type public.staff_role as enum ('director','manager','loan_officer'); exception when duplicate_object then null; end $$;
do $$ begin create type public.member_status as enum ('active','dormant'); exception when duplicate_object then null; end $$;
do $$ begin create type public.loan_status as enum ('pending','active','closed','defaulted','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.tx_type as enum ('deposit','withdrawal','loan_disbursement','loan_repayment','share_purchase','petty_cash','investor_contribution','fee_payment','mpesa_unallocated','staff_payroll'); exception when duplicate_object then null; end $$;
do $$ begin create type public.petty_type as enum ('payment','topup'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_mode as enum ('cash','mpesa','bank'); exception when duplicate_object then null; end $$;
do $$ begin create type public.attendance_status as enum ('present','absent','late'); exception when duplicate_object then null; end $$;
do $$ begin create type public.field_visit_type as enum ('business','home','live'); exception when duplicate_object then null; end $$;
do $$ begin create type public.followup_outcome as enum ('promised','paid','no-show','dispute','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.penalty_status as enum ('outstanding','paid','waived'); exception when duplicate_object then null; end $$;
do $$ begin create type public.penalty_source as enum ('round_off_pool','direct','mpesa','waiver'); exception when duplicate_object then null; end $$;
do $$ begin create type public.roundoff_source as enum ('loan_repayment','savings_deposit','share_purchase','manual'); exception when duplicate_object then null; end $$;

create or replace function public.tg_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create table if not exists public.staff (
  id text primary key, name text not null, role public.staff_role not null,
  email text unique, phone text, national_id text, address text, notes text, photo text,
  temp_password text, can_mark_attendance boolean not null default false,
  fingerprint_enrolled boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.staff enable row level security;
drop trigger if exists trg_staff_updated_at on public.staff;
create trigger trg_staff_updated_at before update on public.staff for each row execute function public.tg_set_updated_at();

create table if not exists public.members (
  id text primary key, name text not null, phone text not null,
  joined_at date not null default current_date, status public.member_status not null default 'active',
  shares integer not null default 0, savings_balance numeric(14,2) not null default 0,
  fee_membership boolean not null default false, fee_card boolean not null default false,
  fee_has_shop boolean not null default false, fee_sticker boolean not null default false,
  fee_first_upfront_paid boolean not null default false,
  is_investor boolean not null default false, investor_id text,
  first_name text, last_name text, dob date, gender text check (gender in ('Male','Female')),
  email text, address text, city text, county text, village text,
  savings_only boolean not null default false, old_system_id text,
  business_name text, business_type text, business_address text, vehicle_plate text,
  field_officer_id text references public.staff(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.members enable row level security;
create index if not exists idx_members_phone on public.members(phone);
create index if not exists idx_members_field_officer on public.members(field_officer_id);
create index if not exists idx_members_vehicle_plate on public.members(vehicle_plate) where vehicle_plate is not null;
drop trigger if exists trg_members_updated_at on public.members;
create trigger trg_members_updated_at before update on public.members for each row execute function public.tg_set_updated_at();

create table if not exists public.investors (
  id text primary key, name text not null, contributed numeric(14,2) not null default 0,
  share_pct numeric(6,3) not null default 0, joined_at date not null default current_date,
  phone text, notes text, member_id text references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.investors enable row level security;
do $$ begin
  alter table public.members add constraint members_investor_fk
    foreign key (investor_id) references public.investors(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.loans (
  id text primary key, member_id text not null references public.members(id) on delete cascade,
  principal numeric(14,2) not null, approved_amount numeric(14,2),
  rate numeric(6,3) not null default 0, term_months integer not null default 0,
  term_days integer check (term_days in (7,14,30)),
  start_date date not null default current_date, status public.loan_status not null default 'pending',
  officer_id text references public.staff(id) on delete set null,
  paid numeric(14,2) not null default 0, purpose text,
  reviewed_by text references public.staff(id) on delete set null, review_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.loans enable row level security;
create index if not exists idx_loans_member on public.loans(member_id);
create index if not exists idx_loans_status on public.loans(status);
drop trigger if exists trg_loans_updated_at on public.loans;
create trigger trg_loans_updated_at before update on public.loans for each row execute function public.tg_set_updated_at();

create table if not exists public.transactions (
  id text primary key, date date not null default current_date, type public.tx_type not null,
  account text, payer_name text, amount numeric(14,2) not null,
  member_id text references public.members(id) on delete set null,
  loan_id text references public.loans(id) on delete set null,
  ref text, by_staff text references public.staff(id) on delete set null, note text,
  created_at timestamptz not null default now()
);
alter table public.transactions enable row level security;
create index if not exists idx_tx_member on public.transactions(member_id);
create index if not exists idx_tx_loan on public.transactions(loan_id);
create index if not exists idx_tx_date on public.transactions(date);
create index if not exists idx_tx_ref on public.transactions(ref);

create table if not exists public.petty_cash (
  id text primary key, date date not null default current_date,
  description text not null, amount numeric(14,2) not null, category text,
  by_staff text references public.staff(id) on delete set null,
  time text, type public.petty_type, payee text, contact text,
  mode public.payment_mode, reference text, txn_cost numeric(14,2), opening_balance numeric(14,2),
  created_at timestamptz not null default now()
);
alter table public.petty_cash enable row level security;

create table if not exists public.attendance (
  id text primary key, staff_id text not null references public.staff(id) on delete cascade,
  date date not null, status public.attendance_status not null,
  check_in text, check_out text, created_at timestamptz not null default now(),
  unique (staff_id, date)
);
alter table public.attendance enable row level security;

create table if not exists public.appraisals (
  id text primary key, member_id text not null references public.members(id) on delete cascade,
  loan_id text references public.loans(id) on delete set null,
  date date not null default current_date,
  officer_id text references public.staff(id) on delete set null,
  good_day numeric(14,2) not null default 0, average_day numeric(14,2) not null default 0,
  bad_day numeric(14,2) not null default 0, operating_expenses numeric(14,2) not null default 0,
  non_earning_days integer not null default 0, existing_debt numeric(14,2) not null default 0,
  monthly_debt_repayment numeric(14,2) not null default 0,
  crb_status text check (crb_status in ('Positive','Negative','Unknown','No Record')),
  reschedules_last_12 integer not null default 0,
  dti numeric(8,3), dicr numeric(8,3), bdsr numeric(8,3), lsr numeric(8,3),
  savings_buffer numeric(14,2),
  score_dicr numeric(6,2), score_bdsr numeric(6,2), score_savings numeric(6,2),
  score_crb numeric(6,2), score_burden numeric(6,2), score_docs numeric(6,2),
  score_coop numeric(6,2), total_score numeric(6,2),
  decision text check (decision in ('Approve','Approve with Adjustments','Refer / Downsize','Reject')),
  risk_level text check (risk_level in ('LOW','MODERATE','HIGH','VERY HIGH')),
  approved_amount numeric(14,2), approved_term text, special_conditions text, notes text,
  created_at timestamptz not null default now()
);
alter table public.appraisals enable row level security;

create table if not exists public.field_visits (
  id text primary key, member_id text not null references public.members(id) on delete cascade,
  date date not null default current_date, type public.field_visit_type not null,
  lat numeric(10,6), lng numeric(10,6), location_notes text, photos text[],
  by_staff text references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.field_visits enable row level security;

create table if not exists public.followups (
  id text primary key, loan_id text not null references public.loans(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  date date not null default current_date, note text not null,
  outcome public.followup_outcome not null,
  by_staff text references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.followups enable row level security;

create table if not exists public.penalties (
  id text primary key, member_id text not null references public.members(id) on delete cascade,
  loan_id text references public.loans(id) on delete set null,
  date date not null default current_date, amount numeric(14,2) not null, reason text not null,
  status public.penalty_status not null default 'outstanding',
  paid_from public.penalty_source, created_at timestamptz not null default now()
);
alter table public.penalties enable row level security;

create table if not exists public.round_off (
  id text primary key, member_id text not null references public.members(id) on delete cascade,
  date date not null default current_date, amount numeric(14,2) not null,
  source public.roundoff_source not null, ref text,
  created_at timestamptz not null default now()
);
alter table public.round_off enable row level security;

create table if not exists public.mpesa_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null, account text, phone text, amount numeric(14,2),
  mpesa_ref text, payer_name text, raw jsonb not null,
  processed boolean not null default false,
  transaction_id text references public.transactions(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.mpesa_events enable row level security;
create index if not exists idx_mpesa_events_account on public.mpesa_events(account);
create index if not exists idx_mpesa_events_ref on public.mpesa_events(mpesa_ref);

insert into public.staff (id, name, role, email, temp_password, can_mark_attendance)
values ('S1','System Admin','director','admin@sauti.co.ke','Sauti1234', true)
on conflict (id) do nothing;

-- =====================================================================
-- Migration: 20260515022412_1a8e13c4-6b70-430d-859f-49564a4ce8dd.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.runtime_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.runtime_secrets
  ADD COLUMN IF NOT EXISTS key TEXT,
  ADD COLUMN IF NOT EXISTS value TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE public.runtime_secrets ENABLE ROW LEVEL SECURITY;
-- No policies = no client access. All reads/writes go through server fns using the service role.

-- =====================================================================
-- Migration: 20260515031307_414f889c-5312-4a07-be1c-8030147c13dc.sql
-- =====================================================================


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

-- =====================================================================
-- Migration: 20260515090000_expand_attendance_statuses.sql
-- =====================================================================

ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'signed_out';
ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'permission';

-- =====================================================================
-- Migration: 20260515103000_database_backed_runtime_data.sql
-- =====================================================================

do $$ begin
  create type public.approval_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fee_scope as enum ('all','new_only','selected_members','loan_holders','investors');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fee_permanence as enum ('permanent','semi');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_thread_status as enum ('ai','open','claimed','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_sender_kind as enum ('member','ai','staff');
exception when duplicate_object then null; end $$;

create table if not exists public.staff_messages (
  id text primary key,
  sender_id text not null references public.staff(id) on delete cascade,
  receiver_id text not null references public.staff(id) on delete cascade,
  sender_name text not null,
  content text,
  attachment jsonb,
  created_at timestamptz not null default now()
);
alter table public.staff_messages enable row level security;
create index if not exists idx_staff_messages_sender on public.staff_messages(sender_id, created_at desc);
create index if not exists idx_staff_messages_receiver on public.staff_messages(receiver_id, created_at desc);

create table if not exists public.staff_memos (
  id text primary key,
  memo_date date not null default current_date,
  title text not null,
  body text not null,
  by_staff_id text references public.staff(id) on delete set null,
  by_name text not null,
  created_at timestamptz not null default now()
);
alter table public.staff_memos enable row level security;
create index if not exists idx_staff_memos_date on public.staff_memos(memo_date desc, created_at desc);

create table if not exists public.approval_requests (
  id text primary key,
  kind text not null,
  title text not null,
  detail text not null,
  requested_by text not null,
  requested_by_name text,
  payload jsonb,
  status public.approval_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_by text,
  review_note text,
  reviewed_at timestamptz
);
alter table public.approval_requests enable row level security;
create index if not exists idx_approval_requests_status on public.approval_requests(status, created_at desc);

create table if not exists public.fee_policies (
  key text primary key,
  label text not null,
  amount numeric(14,2) not null default 0,
  permanence public.fee_permanence not null default 'permanent',
  duration_days integer,
  effective_from date not null default current_date,
  scope public.fee_scope not null default 'all',
  selected_member_ids text[] not null default '{}'::text[],
  custom boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.fee_policies enable row level security;
drop trigger if exists trg_fee_policies_updated_at on public.fee_policies;
create trigger trg_fee_policies_updated_at before update on public.fee_policies
  for each row execute function public.tg_set_updated_at();

insert into public.fee_policies (key, label, amount, permanence, effective_from, scope, custom)
values
  ('membership', 'Membership Fee', 500, 'permanent', current_date, 'all', false),
  ('card', 'Membership Card', 500, 'permanent', current_date, 'all', false),
  ('sticker', 'Shop Sticker', 500, 'permanent', current_date, 'all', false)
on conflict (key) do nothing;

create table if not exists public.support_threads (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  member_name text not null,
  assigned_staff_id text references public.staff(id) on delete set null,
  status public.support_thread_status not null default 'open',
  subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.support_threads enable row level security;
create index if not exists idx_support_threads_status on public.support_threads(status, updated_at desc);
create index if not exists idx_support_threads_assigned on public.support_threads(assigned_staff_id, updated_at desc);
drop trigger if exists trg_support_threads_updated_at on public.support_threads;
create trigger trg_support_threads_updated_at before update on public.support_threads
  for each row execute function public.tg_set_updated_at();

create table if not exists public.support_messages (
  id text primary key,
  thread_id text not null references public.support_threads(id) on delete cascade,
  sender_kind public.support_sender_kind not null,
  sender_name text not null,
  sender_id text,
  text text not null,
  created_at timestamptz not null default now()
);
alter table public.support_messages enable row level security;
create index if not exists idx_support_messages_thread on public.support_messages(thread_id, created_at asc);

-- =====================================================================
-- Migration: 20260516090000_member_name_and_business_permanence.sql
-- =====================================================================

do $$ begin
  create type public.business_permanence as enum ('permanent','semi');
exception when duplicate_object then null; end $$;

alter table public.members
  add column if not exists second_name text,
  add column if not exists third_name text,
  add column if not exists business_permanence public.business_permanence;

update public.members
set
  second_name = coalesce(
    second_name,
    nullif(split_part(trim(coalesce(last_name, '')), ' ', 1), '')
  ),
  third_name = coalesce(
    third_name,
    nullif(
      trim(
        substring(
          trim(coalesce(last_name, ''))
          from position(' ' in trim(coalesce(last_name, ''))) + 1
        )
      ),
      ''
    )
  )
where coalesce(last_name, '') <> '';

update public.members
set
  business_permanence = 'permanent',
  fee_has_shop = true
where business_permanence is null
  and fee_has_shop = true;

update public.members
set
  business_permanence = 'semi',
  fee_has_shop = false,
  fee_sticker = false
where business_permanence = 'semi';

-- =====================================================================
-- Migration: 20260518103000_production_hardening.sql
-- =====================================================================

create sequence if not exists public.members_id_seq;
create sequence if not exists public.investors_id_seq;
create sequence if not exists public.transactions_id_seq;
create sequence if not exists public.staff_id_seq;
create sequence if not exists public.loans_id_seq;
create sequence if not exists public.petty_cash_id_seq;
create sequence if not exists public.appraisals_id_seq;
create sequence if not exists public.field_visits_id_seq;
create sequence if not exists public.followups_id_seq;
create sequence if not exists public.round_off_id_seq;

do $$
declare
  next_value bigint;
begin
  select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint) into next_value from public.members;
  if next_value is null then
    perform setval('public.members_id_seq', 101, false);
  else
    perform setval('public.members_id_seq', next_value, true);
  end if;

  select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint) into next_value from public.investors;
  if next_value is null then
    perform setval('public.investors_id_seq', 1, false);
  else
    perform setval('public.investors_id_seq', next_value, true);
  end if;

  select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint) into next_value from public.transactions;
  if next_value is null then
    perform setval('public.transactions_id_seq', 1, false);
  else
    perform setval('public.transactions_id_seq', next_value, true);
  end if;

  select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint) into next_value from public.staff;
  if next_value is null then
    perform setval('public.staff_id_seq', 1, false);
  else
    perform setval('public.staff_id_seq', next_value, true);
  end if;

  select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint) into next_value from public.loans;
  if next_value is null then
    perform setval('public.loans_id_seq', 1001, false);
  else
    perform setval('public.loans_id_seq', next_value, true);
  end if;

  select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint) into next_value from public.petty_cash;
  if next_value is null then
    perform setval('public.petty_cash_id_seq', 1, false);
  else
    perform setval('public.petty_cash_id_seq', next_value, true);
  end if;

  select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint) into next_value from public.appraisals;
  if next_value is null then
    perform setval('public.appraisals_id_seq', 1, false);
  else
    perform setval('public.appraisals_id_seq', next_value, true);
  end if;

  select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint) into next_value from public.field_visits;
  if next_value is null then
    perform setval('public.field_visits_id_seq', 1, false);
  else
    perform setval('public.field_visits_id_seq', next_value, true);
  end if;

  select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint) into next_value from public.followups;
  if next_value is null then
    perform setval('public.followups_id_seq', 1, false);
  else
    perform setval('public.followups_id_seq', next_value, true);
  end if;

  select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint) into next_value from public.round_off;
  if next_value is null then
    perform setval('public.round_off_id_seq', 1, false);
  else
    perform setval('public.round_off_id_seq', next_value, true);
  end if;
end $$;

create or replace function public.next_entity_id(entity_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value bigint;
begin
  case entity_name
    when 'members' then
      next_value := nextval('public.members_id_seq');
      return 'M' || next_value::text;
    when 'investors' then
      next_value := nextval('public.investors_id_seq');
      return 'I' || next_value::text;
    when 'transactions' then
      next_value := nextval('public.transactions_id_seq');
      return 'T' || next_value::text;
    when 'staff' then
      next_value := nextval('public.staff_id_seq');
      return 'S' || next_value::text;
    when 'loans' then
      next_value := nextval('public.loans_id_seq');
      return 'L' || next_value::text;
    when 'petty_cash' then
      next_value := nextval('public.petty_cash_id_seq');
      return 'P' || next_value::text;
    when 'appraisals' then
      next_value := nextval('public.appraisals_id_seq');
      return 'AP' || next_value::text;
    when 'field_visits' then
      next_value := nextval('public.field_visits_id_seq');
      return 'FV' || next_value::text;
    when 'followups' then
      next_value := nextval('public.followups_id_seq');
      return 'FU' || next_value::text;
    when 'round_off' then
      next_value := nextval('public.round_off_id_seq');
      return 'RO' || next_value::text;
    else
      raise exception 'Unsupported entity name: %', entity_name;
  end case;
end;
$$;

revoke all on function public.next_entity_id(text) from public;
grant execute on function public.next_entity_id(text) to service_role;

create index if not exists idx_mpesa_events_unprocessed
  on public.mpesa_events(kind, processed, created_at);

create index if not exists idx_support_threads_member
  on public.support_threads(member_id, updated_at desc);

-- =====================================================================
-- Migration: 20260518120000_staff_notification_reads.sql
-- =====================================================================

create table if not exists public.staff_notification_reads (
  staff_id text not null references public.staff(id) on delete cascade,
  notice_id text not null,
  read_at timestamptz not null default now(),
  primary key (staff_id, notice_id)
);

create index if not exists idx_staff_notification_reads_staff
  on public.staff_notification_reads(staff_id, read_at desc);

alter table public.staff_notification_reads enable row level security;

-- =====================================================================
-- Migration: 20260518123000_policy_center_settings_and_targets.sql
-- =====================================================================

create table if not exists public.policy_settings (
  key text primary key,
  label text not null,
  value jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.policy_settings enable row level security;
drop trigger if exists trg_policy_settings_updated_at on public.policy_settings;
create trigger trg_policy_settings_updated_at before update on public.policy_settings
  for each row execute function public.tg_set_updated_at();

insert into public.policy_settings (key, label, value, notes)
values
  (
    'percentages',
    'Percentages and fixed values',
    jsonb_build_object(
      'processingPct', 2,
      'insurancePct', 1.5,
      'transactionCostPct', 0,
      'penaltyDailyPct', 5,
      'defaultPenaltyPct', 2,
      'firstUpfrontAmount', 500,
      'mandatorySavingsThreshold', 5000,
      'mandatorySharesThreshold', 3000,
      'roundOffStep', 1
    ),
    'Shared percentage controls for deductions, penalties, and fixed collection prompts.'
  ),
  (
    'interest_rates',
    'Interest rates by term',
    jsonb_build_object(
      '7', 10,
      '14', 15,
      '30', 20,
      '60', 25,
      '90', 30
    ),
    'Fixed interest rates used when pricing new loans by term bucket.'
  ),
  (
    'waterfall_rules',
    'Payment waterfall rules',
    jsonb_build_array(
      jsonb_build_object(
        'scenario', 'member_with_loan',
        'steps', jsonb_build_array(
          'membership_fee',
          'card_fee',
          'sticker_fee',
          'penalties'
        )
      ),
      jsonb_build_object(
        'scenario', 'member_without_loan',
        'steps', jsonb_build_array(
          'membership_fee',
          'card_fee',
          'sticker_fee',
          'penalties'
        )
      ),
      jsonb_build_object(
        'scenario', 'investor_only',
        'steps', jsonb_build_array('investment')
      )
    ),
    'Scenario-based default M-Pesa waterfall rules.'
  )
on conflict (key) do nothing;

create table if not exists public.performance_targets (
  id text primary key,
  metric text not null,
  period text not null,
  expected_value numeric(14,2) not null default 0,
  start_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performance_targets_period_check
    check (period in ('daily', 'weekly', 'monthly', 'annual')),
  constraint performance_targets_metric_check
    check (
      metric in (
        'collections_total',
        'loan_repayments',
        'loan_disbursements',
        'new_loans_count',
        'registrations',
        'cards_paid',
        'stickers_paid',
        'stickers_issued'
      )
    )
);

alter table public.performance_targets enable row level security;
drop trigger if exists trg_performance_targets_updated_at on public.performance_targets;
create trigger trg_performance_targets_updated_at before update on public.performance_targets
  for each row execute function public.tg_set_updated_at();

create index if not exists idx_performance_targets_period_start
  on public.performance_targets(period, start_on desc);

-- =====================================================================
-- Migration: 20260518143000_member_categories_and_sbc_ids.sql
-- =====================================================================

do $$ begin
  create type public.member_category as enum ('member','investor','both','locomotive','stock','service','supplier');
exception when duplicate_object then null; end $$;

alter table public.members
  add column if not exists member_category public.member_category;

update public.members
set member_category = case
  when coalesce(is_investor, false) then 'both'::public.member_category
  else 'member'::public.member_category
end
where member_category is null;

alter table public.members
  alter column member_category set default 'member';

alter table public.members
  alter column member_category set not null;

create sequence if not exists public.members_id_seq;

create or replace function public.next_entity_id(entity_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_value bigint;
begin
  case entity_name
    when 'members' then
      select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::bigint)
        into next_value
      from public.members;

      if next_value is null or next_value < 1 then
        perform setval('public.members_id_seq', 1, false);
      else
        perform setval('public.members_id_seq', next_value, true);
      end if;

      next_value := nextval('public.members_id_seq');
      return 'SBC' || lpad(next_value::text, 4, '0') || 'K';

    when 'investors' then
      next_value := nextval('public.investors_id_seq');
      return 'I' || next_value::text;
    when 'transactions' then
      next_value := nextval('public.transactions_id_seq');
      return 'T' || next_value::text;
    when 'staff' then
      next_value := nextval('public.staff_id_seq');
      return 'S' || next_value::text;
    when 'loans' then
      next_value := nextval('public.loans_id_seq');
      return 'L' || next_value::text;
    when 'petty_cash' then
      next_value := nextval('public.petty_cash_id_seq');
      return 'P' || next_value::text;
    when 'appraisals' then
      next_value := nextval('public.appraisals_id_seq');
      return 'AP' || next_value::text;
    when 'field_visits' then
      next_value := nextval('public.field_visits_id_seq');
      return 'FV' || next_value::text;
    when 'followups' then
      next_value := nextval('public.followups_id_seq');
      return 'FU' || next_value::text;
    when 'round_off' then
      next_value := nextval('public.round_off_id_seq');
      return 'RO' || next_value::text;
    else
      raise exception 'Unsupported entity name: %', entity_name;
  end case;
end;
$$;

revoke all on function public.next_entity_id(text) from public;
grant execute on function public.next_entity_id(text) to service_role;

-- =====================================================================
-- Migration: 20260519103000_legacy_sync_archives_and_penalty_waivers.sql
-- =====================================================================

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
    check (term_days >= 1)
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

-- =====================================================================
-- Migration: 20260519120000_fee_policy_selected_members_and_threshold_sync.sql
-- =====================================================================

alter type public.fee_scope add value if not exists 'selected_members';

alter table public.fee_policies
  add column if not exists selected_member_ids text[] not null default '{}'::text[];

update public.fee_policies
set selected_member_ids = '{}'::text[]
where selected_member_ids is null;

update public.policy_settings
set value = jsonb_set(
  jsonb_set(coalesce(value, '{}'::jsonb), '{mandatorySavingsThreshold}', to_jsonb(5000), true),
  '{mandatorySharesThreshold}',
  to_jsonb(3000),
  true
)
where key = 'percentages';

-- =====================================================================
-- Migration: 20260519153000_mpesa_unallocated_transactions.sql
-- =====================================================================

do $$
begin
  alter type public.tx_type add value if not exists 'mpesa_unallocated';
exception
  when duplicate_object then null;
end $$;

-- =====================================================================
-- Migration: 20260520143000_error_logging_system.sql
-- =====================================================================

-- Create error_logs table for comprehensive application error tracking
create table if not exists public.error_logs (
  id uuid default gen_random_uuid() primary key,
  timestamp text not null,
  level text not null check (level in ('error', 'warning', 'info')),
  category text not null,
  message text not null,
  file text,
  line integer,
  stack text,
  context jsonb,
  user_id uuid,
  created_at timestamp default now(),

  -- For easier querying
  created_date date generated always as (created_at::date) stored
);

alter table public.error_logs
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists timestamp text,
  add column if not exists level text,
  add column if not exists category text,
  add column if not exists message text,
  add column if not exists file text,
  add column if not exists line integer,
  add column if not exists stack text,
  add column if not exists context jsonb,
  add column if not exists user_id uuid,
  add column if not exists created_at timestamp default now(),
  add column if not exists created_date date generated always as (created_at::date) stored;

-- Indexes for common queries
create index if not exists idx_error_logs_created_at on public.error_logs(created_at desc);
create index if not exists idx_error_logs_level on public.error_logs(level);
create index if not exists idx_error_logs_category on public.error_logs(category);
create index if not exists idx_error_logs_user_id on public.error_logs(user_id);
create index if not exists idx_error_logs_created_date on public.error_logs(created_date desc);

-- Composite index for common filter combinations
create index if not exists idx_error_logs_level_created on public.error_logs(level, created_at desc);
create index if not exists idx_error_logs_category_created on public.error_logs(category, created_at desc);

-- Enable RLS
alter table public.error_logs enable row level security;

-- Policy: Allow authenticated users to read all error logs
drop policy if exists "Allow authenticated users to read error logs" on public.error_logs;
create policy "Allow authenticated users to read error logs"
  on public.error_logs for select
  using (auth.role() = 'authenticated');

-- Policy: Allow service role to insert error logs
drop policy if exists "Allow service role to insert error logs" on public.error_logs;
create policy "Allow service role to insert error logs"
  on public.error_logs for insert
  with check (auth.role() = 'service_role');

-- Policy: Allow service role to delete error logs
drop policy if exists "Allow service role to delete error logs" on public.error_logs;
create policy "Allow service role to delete error logs"
  on public.error_logs for delete
  using (auth.role() = 'service_role');

-- Comment on table
comment on table public.error_logs is 'Stores all application errors, warnings, and info logs for debugging and monitoring';
comment on column public.error_logs.level is 'Severity level: error, warning, or info';
comment on column public.error_logs.category is 'Error category for grouping (e.g., "loan_calculation", "payment_processing")';
comment on column public.error_logs.context is 'Additional context data stored as JSON';

-- =====================================================================
-- Migration: 20260520160000_mpesa_system_staff_actor.sql
-- =====================================================================

insert into public.staff (
  id,
  name,
  role,
  can_mark_attendance,
  fingerprint_enrolled
)
values (
  'MPESA',
  'M-Pesa Auto',
  'loan_officer',
  false,
  false
)
on conflict (id) do update
set
  name = excluded.name,
  role = excluded.role,
  can_mark_attendance = false,
  fingerprint_enrolled = false;

-- =====================================================================
-- Migration: 20260520161000_add_field_visit_photo_labels.sql
-- =====================================================================

alter table public.field_visits
  add column if not exists photo_labels text[];

-- =====================================================================
-- Migration: 20260520170000_remove_old_db_topup_sync.sql
-- =====================================================================

drop table if exists public.legacy_topup_imports;
drop table if exists public.legacy_import_sync_runs;

-- =====================================================================
-- Migration: 20260520171000_backfill_processed_mpesa_ledger_links.sql
-- =====================================================================

do $$
declare
  row record;
  tx_id text;
begin
  for row in
    with confirmation_events as (
      select
        e.id,
        e.account,
        upper(trim(e.account)) as normalized_account,
        nullif(regexp_replace(e.account, '\D', '', 'g'), '') as account_digits,
        e.amount,
        e.mpesa_ref,
        e.payer_name,
        e.created_at,
        e.raw
      from public.mpesa_events e
      where e.kind = 'confirmation'
        and e.processed = true
        and e.transaction_id is null
        and coalesce(e.amount, 0) > 0
        and coalesce(trim(e.account), '') <> ''
        and coalesce(e.raw #>> '{Body,stkCallback,ResultCode}', '0') = '0'
    )
    select distinct on (e.id)
      e.id,
      e.normalized_account,
      e.amount,
      e.mpesa_ref,
      e.payer_name,
      e.created_at,
      m.id as member_id
    from confirmation_events e
    join public.members m
      on upper(m.id) = e.normalized_account
      or upper(coalesce(m.old_system_id, '')) = e.normalized_account
      or (
        e.account_digits is not null
        and upper(m.id) in (
          'SBC' || lpad(e.account_digits, 4, '0') || 'K',
          'M' || lpad(e.account_digits, 3, '0')
        )
      )
    order by e.id, m.id
  loop
    select t.id
      into tx_id
    from public.transactions t
    where t.ref is not distinct from row.mpesa_ref
      and upper(coalesce(t.account, '')) = row.normalized_account
      and t.amount = row.amount
    order by t.created_at desc
    limit 1;

    if tx_id is null then
      tx_id := public.next_entity_id('transactions');
      insert into public.transactions (
        id,
        date,
        type,
        amount,
        member_id,
        by_staff,
        note,
        ref,
        account,
        payer_name,
        created_at
      )
      values (
        tx_id,
        coalesce(row.created_at::date, current_date),
        'deposit',
        row.amount,
        row.member_id,
        'MPESA',
        'M-Pesa ledger backfill for processed confirmation',
        row.mpesa_ref,
        row.normalized_account,
        row.payer_name,
        row.created_at
      );
    end if;

    update public.mpesa_events
    set transaction_id = tx_id
    where id = row.id;
  end loop;
end $$;

-- =====================================================================
-- Migration: 20260520183000_payroll_disbursement_and_fee_bands.sql
-- =====================================================================

do $$
begin
  alter type public.tx_type add value if not exists 'staff_payroll';
exception
  when duplicate_object then null;
end
$$;

alter table public.loans
  add column if not exists financed_principal_amount numeric(14,2),
  add column if not exists net_disbursed_amount numeric(14,2),
  add column if not exists processing_fee_amount numeric(14,2) not null default 0,
  add column if not exists insurance_fee_amount numeric(14,2) not null default 0,
  add column if not exists transaction_fee_amount numeric(14,2) not null default 0,
  add column if not exists processing_fee_mode text not null default 'financed',
  add column if not exists insurance_fee_mode text not null default 'financed',
  add column if not exists disbursement_status text not null default 'not_requested',
  add column if not exists disbursement_requested_at timestamptz,
  add column if not exists disbursement_completed_at timestamptz,
  add column if not exists payout_request_id text;

do $$
begin
  alter table public.loans
    add constraint loans_processing_fee_mode_check
    check (processing_fee_mode in ('upfront', 'financed'));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.loans
    add constraint loans_insurance_fee_mode_check
    check (insurance_fee_mode in ('upfront', 'financed'));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.loans
    add constraint loans_disbursement_status_check
    check (disbursement_status in ('not_requested', 'requested', 'paid', 'failed', 'timeout'));
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.staff_payroll_profiles (
  staff_id text primary key references public.staff(id) on delete cascade,
  base_salary numeric(14,2) not null default 0,
  payout_phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_payroll_profiles enable row level security;
drop trigger if exists trg_staff_payroll_profiles_updated_at on public.staff_payroll_profiles;
create trigger trg_staff_payroll_profiles_updated_at
before update on public.staff_payroll_profiles
for each row execute function public.tg_set_updated_at();

create table if not exists public.staff_payroll_payments (
  id text primary key,
  staff_id text not null references public.staff(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  base_salary numeric(14,2) not null default 0,
  work_days integer not null default 0,
  present_days integer not null default 0,
  payable_amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  status text not null default 'requested',
  requested_by text references public.staff(id) on delete set null,
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  transaction_id text references public.transactions(id) on delete set null,
  payout_request_id text,
  note text,
  mpesa_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_payroll_payments_status_check
    check (status in ('requested', 'paid', 'failed', 'timeout'))
);

alter table public.staff_payroll_payments enable row level security;
drop trigger if exists trg_staff_payroll_payments_updated_at on public.staff_payroll_payments;
create trigger trg_staff_payroll_payments_updated_at
before update on public.staff_payroll_payments
for each row execute function public.tg_set_updated_at();

create index if not exists idx_staff_payroll_payments_staff_period
  on public.staff_payroll_payments(staff_id, period_start desc, period_end desc);

create table if not exists public.system_payout_requests (
  id text primary key,
  purpose text not null,
  target_id text,
  member_id text references public.members(id) on delete set null,
  loan_id text references public.loans(id) on delete set null,
  receiver_staff_id text references public.staff(id) on delete set null,
  phone text,
  amount numeric(14,2) not null default 0,
  account_reference text,
  conversation_id text,
  originator_conversation_id text,
  mpesa_ref text,
  remarks text,
  status text not null default 'requested',
  requested_by text references public.staff(id) on delete set null,
  transaction_id text references public.transactions(id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_payout_requests_purpose_check
    check (purpose in ('loan_disbursement', 'staff_payroll')),
  constraint system_payout_requests_status_check
    check (status in ('requested', 'paid', 'failed', 'timeout'))
);

alter table public.system_payout_requests enable row level security;
drop trigger if exists trg_system_payout_requests_updated_at on public.system_payout_requests;
create trigger trg_system_payout_requests_updated_at
before update on public.system_payout_requests
for each row execute function public.tg_set_updated_at();

create index if not exists idx_system_payout_requests_status_created
  on public.system_payout_requests(status, created_at desc);
create index if not exists idx_system_payout_requests_conversation
  on public.system_payout_requests(conversation_id);
create index if not exists idx_system_payout_requests_originator
  on public.system_payout_requests(originator_conversation_id);

insert into public.policy_settings (key, label, value, notes)
values (
  'transaction_fee_bands',
  'Transaction fee bands',
  jsonb_build_array(
    jsonb_build_object(
      'id', 'tx-001',
      'minAmount', 0,
      'maxAmount', 100,
      'feeAmount', 0,
      'label', '0 - 100'
    ),
    jsonb_build_object(
      'id', 'tx-002',
      'minAmount', 101,
      'maxAmount', 500,
      'feeAmount', 7,
      'label', '101 - 500'
    ),
    jsonb_build_object(
      'id', 'tx-003',
      'minAmount', 501,
      'maxAmount', 1000,
      'feeAmount', 13,
      'label', '501 - 1,000'
    ),
    jsonb_build_object(
      'id', 'tx-004',
      'minAmount', 1001,
      'maxAmount', 1500,
      'feeAmount', 23,
      'label', '1,001 - 1,500'
    ),
    jsonb_build_object(
      'id', 'tx-005',
      'minAmount', 1501,
      'maxAmount', 2500,
      'feeAmount', 33,
      'label', '1,501 - 2,500'
    ),
    jsonb_build_object(
      'id', 'tx-006',
      'minAmount', 2501,
      'maxAmount', 3500,
      'feeAmount', 53,
      'label', '2,501 - 3,500'
    ),
    jsonb_build_object(
      'id', 'tx-007',
      'minAmount', 3501,
      'maxAmount', 5000,
      'feeAmount', 57,
      'label', '3,501 - 5,000'
    ),
    jsonb_build_object(
      'id', 'tx-008',
      'minAmount', 5001,
      'maxAmount', 7500,
      'feeAmount', 78,
      'label', '5,001 - 7,500'
    ),
    jsonb_build_object(
      'id', 'tx-009',
      'minAmount', 7501,
      'maxAmount', 10000,
      'feeAmount', 90,
      'label', '7,501 - 10,000'
    ),
    jsonb_build_object(
      'id', 'tx-010',
      'minAmount', 10001,
      'maxAmount', 15000,
      'feeAmount', 100,
      'label', '10,001 - 15,000'
    ),
    jsonb_build_object(
      'id', 'tx-011',
      'minAmount', 15001,
      'maxAmount', 20000,
      'feeAmount', 105,
      'label', '15,001 - 20,000'
    ),
    jsonb_build_object(
      'id', 'tx-012',
      'minAmount', 20001,
      'maxAmount', 35000,
      'feeAmount', 108,
      'label', '20,001 - 35,000'
    ),
    jsonb_build_object(
      'id', 'tx-013',
      'minAmount', 35001,
      'maxAmount', 50000,
      'feeAmount', 108,
      'label', '35,001 - 50,000'
    ),
    jsonb_build_object(
      'id', 'tx-014',
      'minAmount', 50001,
      'maxAmount', 250000,
      'feeAmount', 108,
      'label', '50,001 - 250,000'
    )
  ),
  'Editable fixed transaction-fee brackets used when pricing loans.'
)
on conflict (key) do nothing;

-- =====================================================================
-- Migration: 20260520223000_expand_transaction_fee_band_defaults.sql
-- =====================================================================

with fee_band_defaults as (
  select jsonb_build_array(
    jsonb_build_object('id', 'tx-001', 'minAmount', 0, 'maxAmount', 100, 'feeAmount', 0, 'label', '0 - 100'),
    jsonb_build_object('id', 'tx-002', 'minAmount', 101, 'maxAmount', 500, 'feeAmount', 7, 'label', '101 - 500'),
    jsonb_build_object('id', 'tx-003', 'minAmount', 501, 'maxAmount', 1000, 'feeAmount', 13, 'label', '501 - 1,000'),
    jsonb_build_object('id', 'tx-004', 'minAmount', 1001, 'maxAmount', 1500, 'feeAmount', 23, 'label', '1,001 - 1,500'),
    jsonb_build_object('id', 'tx-005', 'minAmount', 1501, 'maxAmount', 2500, 'feeAmount', 33, 'label', '1,501 - 2,500'),
    jsonb_build_object('id', 'tx-006', 'minAmount', 2501, 'maxAmount', 3500, 'feeAmount', 53, 'label', '2,501 - 3,500'),
    jsonb_build_object('id', 'tx-007', 'minAmount', 3501, 'maxAmount', 5000, 'feeAmount', 57, 'label', '3,501 - 5,000'),
    jsonb_build_object('id', 'tx-008', 'minAmount', 5001, 'maxAmount', 7500, 'feeAmount', 78, 'label', '5,001 - 7,500'),
    jsonb_build_object('id', 'tx-009', 'minAmount', 7501, 'maxAmount', 10000, 'feeAmount', 90, 'label', '7,501 - 10,000'),
    jsonb_build_object('id', 'tx-010', 'minAmount', 10001, 'maxAmount', 15000, 'feeAmount', 100, 'label', '10,001 - 15,000'),
    jsonb_build_object('id', 'tx-011', 'minAmount', 15001, 'maxAmount', 20000, 'feeAmount', 105, 'label', '15,001 - 20,000'),
    jsonb_build_object('id', 'tx-012', 'minAmount', 20001, 'maxAmount', 35000, 'feeAmount', 108, 'label', '20,001 - 35,000'),
    jsonb_build_object('id', 'tx-013', 'minAmount', 35001, 'maxAmount', 50000, 'feeAmount', 108, 'label', '35,001 - 50,000'),
    jsonb_build_object('id', 'tx-014', 'minAmount', 50001, 'maxAmount', 250000, 'feeAmount', 108, 'label', '50,001 - 250,000')
  ) as value
)
insert into public.policy_settings (key, label, value, notes)
select
  'transaction_fee_bands',
  'Transaction fee bands',
  value,
  'Editable fixed transaction-fee brackets used when pricing loans.'
from fee_band_defaults
on conflict (key) do nothing;

with fee_band_defaults as (
  select jsonb_build_array(
    jsonb_build_object('id', 'tx-001', 'minAmount', 0, 'maxAmount', 100, 'feeAmount', 0, 'label', '0 - 100'),
    jsonb_build_object('id', 'tx-002', 'minAmount', 101, 'maxAmount', 500, 'feeAmount', 7, 'label', '101 - 500'),
    jsonb_build_object('id', 'tx-003', 'minAmount', 501, 'maxAmount', 1000, 'feeAmount', 13, 'label', '501 - 1,000'),
    jsonb_build_object('id', 'tx-004', 'minAmount', 1001, 'maxAmount', 1500, 'feeAmount', 23, 'label', '1,001 - 1,500'),
    jsonb_build_object('id', 'tx-005', 'minAmount', 1501, 'maxAmount', 2500, 'feeAmount', 33, 'label', '1,501 - 2,500'),
    jsonb_build_object('id', 'tx-006', 'minAmount', 2501, 'maxAmount', 3500, 'feeAmount', 53, 'label', '2,501 - 3,500'),
    jsonb_build_object('id', 'tx-007', 'minAmount', 3501, 'maxAmount', 5000, 'feeAmount', 57, 'label', '3,501 - 5,000'),
    jsonb_build_object('id', 'tx-008', 'minAmount', 5001, 'maxAmount', 7500, 'feeAmount', 78, 'label', '5,001 - 7,500'),
    jsonb_build_object('id', 'tx-009', 'minAmount', 7501, 'maxAmount', 10000, 'feeAmount', 90, 'label', '7,501 - 10,000'),
    jsonb_build_object('id', 'tx-010', 'minAmount', 10001, 'maxAmount', 15000, 'feeAmount', 100, 'label', '10,001 - 15,000'),
    jsonb_build_object('id', 'tx-011', 'minAmount', 15001, 'maxAmount', 20000, 'feeAmount', 105, 'label', '15,001 - 20,000'),
    jsonb_build_object('id', 'tx-012', 'minAmount', 20001, 'maxAmount', 35000, 'feeAmount', 108, 'label', '20,001 - 35,000'),
    jsonb_build_object('id', 'tx-013', 'minAmount', 35001, 'maxAmount', 50000, 'feeAmount', 108, 'label', '35,001 - 50,000'),
    jsonb_build_object('id', 'tx-014', 'minAmount', 50001, 'maxAmount', 250000, 'feeAmount', 108, 'label', '50,001 - 250,000')
  ) as value
)
update public.policy_settings as ps
set
  value = fee_band_defaults.value,
  notes = 'Editable fixed transaction-fee brackets used when pricing loans.',
  updated_at = now()
from fee_band_defaults
where ps.key = 'transaction_fee_bands'
  and (
    ps.value is null
    or jsonb_typeof(ps.value) <> 'array'
    or jsonb_array_length(ps.value) <= 2
  );

-- =====================================================================
-- Migration: 20260521100000_reconcile_mpesa_transactions_and_fee_policy_scope.sql
-- =====================================================================

do $$
begin
  alter type public.tx_type add value if not exists 'mpesa_unallocated';
exception
  when duplicate_object then null;
end $$;

alter table public.fee_policies
  add column if not exists selected_member_ids text[] not null default '{}'::text[];

update public.fee_policies
set selected_member_ids = '{}'::text[]
where selected_member_ids is null;

insert into public.staff (
  id,
  name,
  role,
  can_mark_attendance,
  fingerprint_enrolled
)
values (
  'MPESA',
  'M-Pesa Auto',
  'loan_officer',
  false,
  false
)
on conflict (id) do update
set
  name = excluded.name,
  role = excluded.role,
  can_mark_attendance = false,
  fingerprint_enrolled = false;

drop table if exists pg_temp._duplicate_mpesa_transactions;

create temp table _duplicate_mpesa_transactions on commit drop as
select *
from (
  select
    t.*,
    row_number() over (
      partition by
        t.ref,
        t.type,
        t.amount,
        coalesce(t.account, ''),
        coalesce(t.member_id, ''),
        coalesce(t.loan_id, ''),
        coalesce(t.note, ''),
        coalesce(t.payer_name, '')
      order by t.created_at asc, t.id asc
    ) as duplicate_rank
  from public.transactions t
  where t.by_staff = 'MPESA'
    and coalesce(trim(t.ref), '') <> ''
) ranked
where duplicate_rank > 1;

update public.members m
set savings_balance = greatest(0, coalesce(m.savings_balance, 0) - duplicate_totals.amount)
from (
  select member_id, sum(amount) as amount
  from _duplicate_mpesa_transactions
  where type = 'deposit'
    and member_id is not null
  group by member_id
) duplicate_totals
where m.id = duplicate_totals.member_id;

update public.members m
set shares = greatest(0, coalesce(m.shares, 0) - duplicate_totals.units)
from (
  select member_id, sum(floor(amount / 500)) as units
  from _duplicate_mpesa_transactions
  where type = 'share_purchase'
    and member_id is not null
  group by member_id
) duplicate_totals
where m.id = duplicate_totals.member_id;

update public.investors i
set contributed = greatest(0, coalesce(i.contributed, 0) - duplicate_totals.amount)
from (
  select member_id, sum(amount) as amount
  from _duplicate_mpesa_transactions
  where type = 'investor_contribution'
    and member_id is not null
  group by member_id
) duplicate_totals
where i.member_id = duplicate_totals.member_id;

update public.loans l
set paid = greatest(0, coalesce(l.paid, 0) - duplicate_totals.amount)
from (
  select loan_id, sum(amount) as amount
  from _duplicate_mpesa_transactions
  where type = 'loan_repayment'
    and loan_id is not null
  group by loan_id
) duplicate_totals
where l.id = duplicate_totals.loan_id;

delete from public.transactions t
using _duplicate_mpesa_transactions d
where t.id = d.id;

with event_matches as (
  select distinct on (e.id)
    e.id as event_id,
    t.id as transaction_id
  from public.mpesa_events e
  join public.transactions t
    on t.by_staff = 'MPESA'
    and t.ref is not distinct from e.mpesa_ref
    and upper(coalesce(t.account, '')) = upper(trim(coalesce(e.account, '')))
  where e.kind = 'confirmation'
    and e.transaction_id is null
    and coalesce(trim(e.mpesa_ref), '') <> ''
    and coalesce(trim(e.account), '') <> ''
  order by e.id, t.created_at asc, t.id asc
)
update public.mpesa_events e
set
  processed = true,
  transaction_id = event_matches.transaction_id
from event_matches
where e.id = event_matches.event_id;

do $$
declare
  row record;
  tx_id text;
begin
  for row in
    with confirmation_events as (
      select
        e.id,
        upper(trim(e.account)) as normalized_account,
        nullif(regexp_replace(e.account, '\D', '', 'g'), '') as account_digits,
        e.amount,
        e.mpesa_ref,
        e.payer_name,
        e.created_at
      from public.mpesa_events e
      where e.kind = 'confirmation'
        and e.transaction_id is null
        and coalesce(e.amount, 0) > 0
        and coalesce(trim(e.account), '') <> ''
    )
    select distinct on (e.id)
      e.id,
      e.normalized_account,
      e.amount,
      e.mpesa_ref,
      e.payer_name,
      e.created_at,
      m.id as member_id
    from confirmation_events e
    left join public.members m
      on upper(m.id) = e.normalized_account
      or upper(coalesce(m.old_system_id, '')) = e.normalized_account
      or (
        e.account_digits is not null
        and upper(m.id) in (
          'SBC' || lpad(e.account_digits, 4, '0') || 'K',
          'M' || lpad(e.account_digits, 3, '0')
        )
    )
    order by e.id, m.id nulls last
  loop
    tx_id := null;

    select t.id
      into tx_id
    from public.transactions t
    where t.by_staff = 'MPESA'
      and t.ref is not distinct from row.mpesa_ref
      and upper(coalesce(t.account, '')) = row.normalized_account
    order by t.created_at asc, t.id asc
    limit 1;

    if tx_id is null then
      tx_id := public.next_entity_id('transactions');
      insert into public.transactions (
        id,
        date,
        type,
        amount,
        member_id,
        by_staff,
        note,
        ref,
        account,
        payer_name,
        created_at
      )
      values (
        tx_id,
        coalesce(row.created_at::date, current_date),
        case when row.member_id is null then 'mpesa_unallocated'::public.tx_type else 'deposit'::public.tx_type end,
        row.amount,
        row.member_id,
        'MPESA',
        case
          when row.member_id is null then 'M-Pesa ledger backfill without a matched member'
          else 'M-Pesa ledger backfill for confirmation'
        end,
        row.mpesa_ref,
        row.normalized_account,
        row.payer_name,
        row.created_at
      );
    end if;

    update public.mpesa_events
    set
      processed = true,
      transaction_id = tx_id
    where id = row.id;
  end loop;
end $$;

create unique index if not exists idx_transactions_mpesa_unique_ref_allocation
  on public.transactions (
    ref,
    type,
    amount,
    (coalesce(account, '')),
    (coalesce(member_id, '')),
    (coalesce(loan_id, '')),
    (coalesce(note, '')),
    (coalesce(payer_name, ''))
  )
  where by_staff = 'MPESA'
    and coalesce(trim(ref), '') <> '';

create index if not exists idx_mpesa_events_confirmation_ref
  on public.mpesa_events(kind, mpesa_ref, created_at)
  where kind = 'confirmation'
    and mpesa_ref is not null;

-- =====================================================================
-- Migration: 20260521113000_standard_premium_interest_and_share_price_policy.sql
-- =====================================================================

do $$
begin
  alter table public.loans drop constraint if exists loans_term_days_check;
  alter table public.loans
    add constraint loans_term_days_check
    check (
      term_days is null
      or (
        coalesce(nullif(loan_kind, ''), 'financial') = 'financial'
        and term_days in (7, 14, 30, 60, 90)
      )
      or (
        coalesce(nullif(loan_kind, ''), 'financial') in ('fuel', 'stock', 'service')
        and term_days >= 1
      )
    );
exception
  when duplicate_object then null;
end
$$;

insert into public.policy_settings (key, label, value, notes)
values (
  'interest_rates',
  'Interest rates by term',
  jsonb_build_object(
    'standard', jsonb_build_object(
      '7', 10,
      '14', 15,
      '30', 20
    ),
    'premium', jsonb_build_object(
      '14', 15,
      '30', 20,
      '60', 25,
      '90', 25
    )
  ),
  'Separate standard and premium loan interest bands. Manual day entries use the next matching term bucket.'
)
on conflict (key) do update
set
  label = excluded.label,
  value = case
    when jsonb_typeof(public.policy_settings.value->'standard') = 'object'
      and jsonb_typeof(public.policy_settings.value->'premium') = 'object'
      then jsonb_set(
        jsonb_set(
          public.policy_settings.value,
          '{premium,60}',
          coalesce(public.policy_settings.value #> '{premium,60}', '25'::jsonb),
          true
        ),
        '{premium,90}',
        coalesce(public.policy_settings.value #> '{premium,90}', '25'::jsonb),
        true
      )
    else jsonb_build_object(
      'standard', jsonb_build_object(
        '7', coalesce(public.policy_settings.value->'7', '10'::jsonb),
        '14', coalesce(public.policy_settings.value->'14', '15'::jsonb),
        '30', coalesce(public.policy_settings.value->'30', '20'::jsonb)
      ),
      'premium', jsonb_build_object(
        '14', coalesce(public.policy_settings.value->'14', '15'::jsonb),
        '30', coalesce(public.policy_settings.value->'30', '20'::jsonb),
        '60', coalesce(public.policy_settings.value->'60', '25'::jsonb),
        '90', '25'::jsonb
      )
    )
  end,
  notes = excluded.notes,
  updated_at = now();

-- =====================================================================
-- Migration: 20260521133000_mpesa_receipt_allocations_and_audit.sql
-- =====================================================================

create table if not exists public.mpesa_receipt_allocations (
  id text primary key,
  event_id uuid references public.mpesa_events(id) on delete cascade,
  mpesa_ref text,
  member_id text references public.members(id) on delete set null,
  loan_id text references public.loans(id) on delete set null,
  transaction_id text references public.transactions(id) on delete set null,
  allocation_type text not null,
  amount numeric(14,2) not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_mpesa_receipt_allocations_event
  on public.mpesa_receipt_allocations(event_id, created_at desc);

create index if not exists idx_mpesa_receipt_allocations_ref
  on public.mpesa_receipt_allocations(mpesa_ref, created_at desc);

create index if not exists idx_mpesa_receipt_allocations_member
  on public.mpesa_receipt_allocations(member_id, created_at desc);

drop index if exists public.idx_mpesa_receipt_allocations_unique_tx;

create unique index if not exists idx_mpesa_receipt_allocations_unique_tx
  on public.mpesa_receipt_allocations (
    coalesce(event_id::text, ''),
    transaction_id,
    allocation_type
  )
  where transaction_id is not null;

with mpesa_transaction_rows as (
  select
    coalesce(nullif(trim(tx.ref), ''), tx.id) as receipt_ref,
    tx.*
  from public.transactions tx
  where tx.by_staff = 'MPESA'
),
primary_mpesa_transactions as (
  select distinct on (receipt_ref)
    receipt_ref,
    id as primary_transaction_id
  from mpesa_transaction_rows
  order by
    receipt_ref,
    case when type = 'mpesa_unallocated' then 1 else 0 end,
    created_at asc,
    id asc
),
current_mpesa_receipts as (
  select
    tx.receipt_ref,
    max(nullif(trim(tx.account), '')) as account,
    max(nullif(trim(tx.payer_name), '')) as payer_name,
    primary_tx.primary_transaction_id,
    min(tx.created_at) as created_at,
    sum(coalesce(tx.amount, 0)) as transaction_amount
  from mpesa_transaction_rows tx
  join primary_mpesa_transactions primary_tx
    on primary_tx.receipt_ref = tx.receipt_ref
  group by tx.receipt_ref, primary_tx.primary_transaction_id
),
round_off_totals as (
  select
    nullif(trim(ref), '') as receipt_ref,
    sum(coalesce(amount, 0)) as amount
  from public.round_off
  where coalesce(trim(ref), '') <> ''
  group by nullif(trim(ref), '')
)
insert into public.mpesa_events (
  kind,
  account,
  amount,
  mpesa_ref,
  payer_name,
  raw,
  processed,
  transaction_id,
  created_at
)
select
  'confirmation',
  receipt.account,
  receipt.transaction_amount + coalesce(round_off.amount, 0),
  receipt.receipt_ref,
  receipt.payer_name,
  jsonb_build_object(
    'TransactionType', 'Backfilled M-Pesa receipt',
    'TransID', receipt.receipt_ref,
    'BillRefNumber', receipt.account,
    'TransAmount', (receipt.transaction_amount + coalesce(round_off.amount, 0))::text,
    'FirstName', receipt.payer_name,
    'BackfilledFrom', 'public.transactions'
  ),
  true,
  receipt.primary_transaction_id,
  coalesce(receipt.created_at, now())
from current_mpesa_receipts receipt
left join round_off_totals round_off
  on round_off.receipt_ref = receipt.receipt_ref
where not exists (
  select 1
  from public.mpesa_events existing
  where existing.kind = 'confirmation'
    and existing.mpesa_ref = receipt.receipt_ref
);

update public.mpesa_receipt_allocations allocation
set
  event_id = event.id,
  mpesa_ref = event.mpesa_ref
from public.mpesa_events event
where allocation.event_id is null
  and event.kind = 'confirmation'
  and coalesce(trim(allocation.mpesa_ref), '') <> ''
  and event.mpesa_ref = allocation.mpesa_ref;

insert into public.mpesa_receipt_allocations (
  id,
  event_id,
  mpesa_ref,
  member_id,
  loan_id,
  transaction_id,
  allocation_type,
  amount,
  note,
  created_at
)
select
  'MRA' || substr(md5('tx:' || tx.id || ':' || coalesce(e.id::text, receipt.receipt_ref)), 1, 24),
  e.id,
  coalesce(e.mpesa_ref, receipt.receipt_ref),
  tx.member_id,
  tx.loan_id,
  tx.id,
  tx.type::text,
  tx.amount,
  tx.note,
  coalesce(tx.created_at, e.created_at, now())
from public.transactions tx
cross join lateral (
  select coalesce(nullif(trim(tx.ref), ''), tx.id) as receipt_ref
) receipt
left join public.mpesa_events e
  on e.kind = 'confirmation'
 and e.mpesa_ref = receipt.receipt_ref
where tx.by_staff = 'MPESA'
  and not exists (
    select 1
    from public.mpesa_receipt_allocations existing
    where existing.transaction_id = tx.id
      and existing.allocation_type = tx.type::text
  );

update public.mpesa_receipt_allocations allocation
set
  event_id = event.id,
  mpesa_ref = event.mpesa_ref
from public.mpesa_events event
where allocation.event_id is null
  and event.kind = 'confirmation'
  and coalesce(trim(allocation.mpesa_ref), '') <> ''
  and event.mpesa_ref = allocation.mpesa_ref;

insert into public.mpesa_receipt_allocations (
  id,
  event_id,
  mpesa_ref,
  member_id,
  transaction_id,
  allocation_type,
  amount,
  note,
  created_at
)
select
  'MRA' || substr(md5(ro.id || ':' || coalesce(e.id::text, ro.ref, ro.id)), 1, 24),
  e.id,
  coalesce(e.mpesa_ref, ro.ref),
  ro.member_id,
  null,
  'round_off',
  ro.amount,
  'Round-off captured from M-Pesa receipt',
  coalesce(ro.created_at, e.created_at, now())
from public.round_off ro
left join public.mpesa_events e
  on e.kind = 'confirmation'
 and e.mpesa_ref = ro.ref
where ro.ref is not null
  and not exists (
    select 1
    from public.mpesa_receipt_allocations existing
    where existing.event_id is not distinct from e.id
      and existing.allocation_type = 'round_off'
      and existing.amount = ro.amount
      and coalesce(existing.member_id, '') = coalesce(ro.member_id, '')
      and coalesce(existing.note, '') = 'Round-off captured from M-Pesa receipt'
  );

-- =====================================================================
-- Migration: 20260521134500_backfill_current_mpesa_receipt_allocations.sql
-- =====================================================================

with mpesa_transaction_rows as (
  select
    coalesce(nullif(trim(tx.ref), ''), tx.id) as receipt_ref,
    tx.*
  from public.transactions tx
  where tx.by_staff = 'MPESA'
),
primary_mpesa_transactions as (
  select distinct on (receipt_ref)
    receipt_ref,
    id as primary_transaction_id
  from mpesa_transaction_rows
  order by
    receipt_ref,
    case when type = 'mpesa_unallocated' then 1 else 0 end,
    created_at asc,
    id asc
),
current_mpesa_receipts as (
  select
    tx.receipt_ref,
    max(nullif(trim(tx.account), '')) as account,
    max(nullif(trim(tx.payer_name), '')) as payer_name,
    primary_tx.primary_transaction_id,
    min(tx.created_at) as created_at,
    sum(coalesce(tx.amount, 0)) as transaction_amount
  from mpesa_transaction_rows tx
  join primary_mpesa_transactions primary_tx
    on primary_tx.receipt_ref = tx.receipt_ref
  group by tx.receipt_ref, primary_tx.primary_transaction_id
),
round_off_totals as (
  select
    nullif(trim(ref), '') as receipt_ref,
    sum(coalesce(amount, 0)) as amount
  from public.round_off
  where coalesce(trim(ref), '') <> ''
  group by nullif(trim(ref), '')
)
insert into public.mpesa_events (
  kind,
  account,
  amount,
  mpesa_ref,
  payer_name,
  raw,
  processed,
  transaction_id,
  created_at
)
select
  'confirmation',
  receipt.account,
  receipt.transaction_amount + coalesce(round_off.amount, 0),
  receipt.receipt_ref,
  receipt.payer_name,
  jsonb_build_object(
    'TransactionType', 'Backfilled M-Pesa receipt',
    'TransID', receipt.receipt_ref,
    'BillRefNumber', receipt.account,
    'TransAmount', (receipt.transaction_amount + coalesce(round_off.amount, 0))::text,
    'FirstName', receipt.payer_name,
    'BackfilledFrom', 'public.transactions'
  ),
  true,
  receipt.primary_transaction_id,
  coalesce(receipt.created_at, now())
from current_mpesa_receipts receipt
left join round_off_totals round_off
  on round_off.receipt_ref = receipt.receipt_ref
where not exists (
  select 1
  from public.mpesa_events existing
  where existing.kind = 'confirmation'
    and existing.mpesa_ref = receipt.receipt_ref
);

update public.mpesa_receipt_allocations allocation
set
  event_id = event.id,
  mpesa_ref = event.mpesa_ref
from public.mpesa_events event
where allocation.event_id is null
  and event.kind = 'confirmation'
  and coalesce(trim(allocation.mpesa_ref), '') <> ''
  and event.mpesa_ref = allocation.mpesa_ref;

insert into public.mpesa_receipt_allocations (
  id,
  event_id,
  mpesa_ref,
  member_id,
  loan_id,
  transaction_id,
  allocation_type,
  amount,
  note,
  created_at
)
select
  'MRA' || substr(md5('tx:' || tx.id || ':' || coalesce(e.id::text, receipt.receipt_ref)), 1, 24),
  e.id,
  coalesce(e.mpesa_ref, receipt.receipt_ref),
  tx.member_id,
  tx.loan_id,
  tx.id,
  tx.type::text,
  tx.amount,
  tx.note,
  coalesce(tx.created_at, e.created_at, now())
from public.transactions tx
cross join lateral (
  select coalesce(nullif(trim(tx.ref), ''), tx.id) as receipt_ref
) receipt
left join public.mpesa_events e
  on e.kind = 'confirmation'
 and e.mpesa_ref = receipt.receipt_ref
where tx.by_staff = 'MPESA'
  and not exists (
    select 1
    from public.mpesa_receipt_allocations existing
    where existing.transaction_id = tx.id
      and existing.allocation_type = tx.type::text
  );

insert into public.mpesa_receipt_allocations (
  id,
  event_id,
  mpesa_ref,
  member_id,
  transaction_id,
  allocation_type,
  amount,
  note,
  created_at
)
select
  'MRA' || substr(md5('round_off:' || ro.id || ':' || coalesce(e.id::text, ro.ref, ro.id)), 1, 24),
  e.id,
  coalesce(e.mpesa_ref, ro.ref),
  ro.member_id,
  null,
  'round_off',
  ro.amount,
  'Round-off captured from M-Pesa receipt',
  coalesce(ro.created_at, e.created_at, now())
from public.round_off ro
left join public.mpesa_events e
  on e.kind = 'confirmation'
 and e.mpesa_ref = ro.ref
where ro.ref is not null
  and not exists (
    select 1
    from public.mpesa_receipt_allocations existing
    where existing.event_id is not distinct from e.id
      and existing.allocation_type = 'round_off'
      and existing.amount = ro.amount
      and coalesce(existing.member_id, '') = coalesce(ro.member_id, '')
      and coalesce(existing.note, '') = 'Round-off captured from M-Pesa receipt'
  );

update public.mpesa_receipt_allocations allocation
set
  event_id = event.id,
  mpesa_ref = event.mpesa_ref
from public.mpesa_events event
where allocation.event_id is null
  and event.kind = 'confirmation'
  and coalesce(trim(allocation.mpesa_ref), '') <> ''
  and event.mpesa_ref = allocation.mpesa_ref;

-- =====================================================================
-- Migration: 20260522100000_low_egress_auto_sync_versions.sql
-- =====================================================================

-- Give the client a cheap, reliable way to detect changed data before
-- downloading the full app snapshot.

alter table if exists public.transactions add column if not exists updated_at timestamptz not null default now();
alter table if exists public.petty_cash add column if not exists updated_at timestamptz not null default now();
alter table if exists public.investors add column if not exists updated_at timestamptz not null default now();
alter table if exists public.attendance add column if not exists updated_at timestamptz not null default now();
alter table if exists public.appraisals add column if not exists updated_at timestamptz not null default now();
alter table if exists public.field_visits add column if not exists updated_at timestamptz not null default now();
alter table if exists public.followups add column if not exists updated_at timestamptz not null default now();
alter table if exists public.penalties add column if not exists updated_at timestamptz not null default now();
alter table if exists public.round_off add column if not exists updated_at timestamptz not null default now();
alter table if exists public.staff_messages add column if not exists updated_at timestamptz not null default now();
alter table if exists public.mpesa_events add column if not exists updated_at timestamptz not null default now();
alter table if exists public.mpesa_receipt_allocations add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_transactions_updated_at on public.transactions;
create trigger trg_transactions_updated_at before update on public.transactions
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_petty_cash_updated_at on public.petty_cash;
create trigger trg_petty_cash_updated_at before update on public.petty_cash
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_investors_updated_at on public.investors;
create trigger trg_investors_updated_at before update on public.investors
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_attendance_updated_at on public.attendance;
create trigger trg_attendance_updated_at before update on public.attendance
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_appraisals_updated_at on public.appraisals;
create trigger trg_appraisals_updated_at before update on public.appraisals
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_field_visits_updated_at on public.field_visits;
create trigger trg_field_visits_updated_at before update on public.field_visits
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_followups_updated_at on public.followups;
create trigger trg_followups_updated_at before update on public.followups
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_penalties_updated_at on public.penalties;
create trigger trg_penalties_updated_at before update on public.penalties
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_round_off_updated_at on public.round_off;
create trigger trg_round_off_updated_at before update on public.round_off
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_staff_messages_updated_at on public.staff_messages;
create trigger trg_staff_messages_updated_at before update on public.staff_messages
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_mpesa_events_updated_at on public.mpesa_events;
create trigger trg_mpesa_events_updated_at before update on public.mpesa_events
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_mpesa_receipt_allocations_updated_at on public.mpesa_receipt_allocations;
create trigger trg_mpesa_receipt_allocations_updated_at before update on public.mpesa_receipt_allocations
  for each row execute function public.tg_set_updated_at();

-- =====================================================================
-- Migration: 20260522130000_carryover_loan_fee_breakdown.sql
-- =====================================================================

alter table public.member_carryover_loans
  add column if not exists fee_breakdown jsonb not null default '{}'::jsonb;

-- =====================================================================
-- Migration: 20260523120000_member_allocation_categories_and_share_reserve.sql
-- =====================================================================

alter type public.member_category add value if not exists 'locomotive';
alter type public.member_category add value if not exists 'stock';
alter type public.member_category add value if not exists 'service';

alter table public.members
  add column if not exists share_reserve_balance numeric(14,2) not null default 0;

comment on column public.members.share_reserve_balance is
  'Pending mandatory share money below one full share unit. Converted into shares by the M-Pesa allocator once it reaches the share price.';

-- =====================================================================
-- Migration: 20260523133000_withdrawal_operations_suppliers_and_dockets.sql
-- =====================================================================

do $$ begin
  create type public.member_docket as enum (
    'withdrawable_savings',
    'mandatory_savings',
    'loan_savings',
    'shares',
    'share_reserve',
    'purpose_pool',
    'investment',
    'penalty_payment'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.supplier_kind as enum ('fuel','stock','service');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.supplier_request_status as enum ('draft','sent','fulfilled','rejected','paid','cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.system_outflow_kind as enum (
    'client_withdrawal',
    'supplier_payment',
    'investor_withdrawal',
    'staff_payment',
    'loan_disbursement',
    'petty_cash',
    'docket_transfer',
    'other'
  );
exception when duplicate_object then null; end $$;

alter table public.loans
  add column if not exists loan_kind text not null default 'financial',
  add column if not exists supplier_id text,
  add column if not exists supplier_request_status public.supplier_request_status,
  add column if not exists supplier_payload jsonb not null default '{}'::jsonb;

create table if not exists public.member_docket_balances (
  member_id text not null references public.members(id) on delete cascade,
  docket public.member_docket not null,
  amount numeric(14,2) not null default 0,
  protected boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (member_id, docket)
);
alter table public.member_docket_balances enable row level security;

create table if not exists public.member_docket_movements (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  from_docket public.member_docket,
  to_docket public.member_docket,
  amount numeric(14,2) not null,
  reason text,
  by_staff text references public.staff(id) on delete set null,
  protected boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.member_docket_movements enable row level security;
create index if not exists idx_member_docket_movements_member on public.member_docket_movements(member_id, created_at desc);

create table if not exists public.suppliers (
  id text primary key,
  name text not null,
  kind public.supplier_kind not null,
  phone text,
  contact_person text,
  location text,
  notes text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.suppliers enable row level security;

create table if not exists public.supplier_fulfillment_requests (
  id text primary key,
  supplier_id text not null references public.suppliers(id) on delete restrict,
  loan_id text references public.loans(id) on delete set null,
  member_id text references public.members(id) on delete set null,
  kind public.supplier_kind not null,
  amount numeric(14,2) not null,
  detail jsonb not null default '{}'::jsonb,
  status public.supplier_request_status not null default 'sent',
  requested_by text references public.staff(id) on delete set null,
  fulfilled_by_name text,
  fulfilled_at timestamptz,
  paid_transaction_id text references public.transactions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.supplier_fulfillment_requests enable row level security;
create index if not exists idx_supplier_requests_status on public.supplier_fulfillment_requests(status, created_at desc);
create index if not exists idx_supplier_requests_supplier on public.supplier_fulfillment_requests(supplier_id, created_at desc);

create table if not exists public.system_outflows (
  id text primary key,
  kind public.system_outflow_kind not null,
  amount numeric(14,2) not null,
  receiver_name text not null,
  receiver_phone text,
  method text not null default 'cash',
  member_id text references public.members(id) on delete set null,
  staff_id text references public.staff(id) on delete set null,
  investor_id text references public.investors(id) on delete set null,
  supplier_id text references public.suppliers(id) on delete set null,
  loan_id text references public.loans(id) on delete set null,
  transaction_id text references public.transactions(id) on delete set null,
  note text,
  by_staff text references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.system_outflows enable row level security;
create index if not exists idx_system_outflows_kind on public.system_outflows(kind, created_at desc);

-- =====================================================================
-- Migration: 20260523160000_supplier_portal_inventory_and_fuel_verification.sql
-- =====================================================================

alter table public.suppliers
  add column if not exists member_id text references public.members(id) on delete set null;

create unique index if not exists idx_suppliers_member_id on public.suppliers(member_id)
where member_id is not null;

create table if not exists public.internal_store_items (
  id text primary key,
  item_name text not null,
  item_kind public.supplier_kind not null default 'stock',
  unit text not null default 'unit',
  quantity_available numeric(14,2) not null default 0,
  reorder_level numeric(14,2) not null default 0,
  unit_price numeric(14,2) not null default 0,
  preferred_supplier_id text references public.suppliers(id) on delete set null,
  notes text,
  created_by text references public.staff(id) on delete set null,
  updated_by text references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.internal_store_items enable row level security;
create index if not exists idx_internal_store_items_kind_name
on public.internal_store_items(item_kind, item_name);

create table if not exists public.supplier_inventory_items (
  id text primary key,
  supplier_id text not null references public.suppliers(id) on delete cascade,
  item_name text not null,
  item_kind public.supplier_kind not null,
  unit text not null default 'unit',
  quantity_available numeric(14,2) not null default 0,
  unit_price numeric(14,2) not null default 0,
  sku text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.supplier_inventory_items enable row level security;
create index if not exists idx_supplier_inventory_supplier
on public.supplier_inventory_items(supplier_id, item_name);
create index if not exists idx_supplier_inventory_lookup
on public.supplier_inventory_items(item_kind, item_name);

alter table public.supplier_fulfillment_requests
  add column if not exists commodity_name text,
  add column if not exists quantity_requested numeric(14,2),
  add column if not exists unit_of_measure text,
  add column if not exists vehicle_plate text,
  add column if not exists fuel_type text,
  add column if not exists driver_member_id text references public.members(id) on delete set null,
  add column if not exists verification_code text,
  add column if not exists verification_code_issued_at timestamptz,
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by_member_id text references public.members(id) on delete set null,
  add column if not exists verification_note text;

create index if not exists idx_supplier_requests_driver
on public.supplier_fulfillment_requests(driver_member_id, created_at desc);

-- =====================================================================
-- Migration: 20260525110000_stock_pricing_and_supplier_inventory_details.sql
-- =====================================================================

alter table public.internal_store_items
  add column if not exists buying_price numeric(14,2) not null default 0,
  add column if not exists selling_price numeric(14,2) not null default 0,
  add column if not exists brand text,
  add column if not exists quality text;

alter table public.supplier_inventory_items
  add column if not exists buying_price numeric(14,2) not null default 0,
  add column if not exists selling_price numeric(14,2) not null default 0,
  add column if not exists brand text,
  add column if not exists quality text;

update public.internal_store_items
set buying_price = unit_price
where buying_price = 0 and unit_price > 0;

update public.internal_store_items
set selling_price = unit_price
where selling_price = 0 and unit_price > 0;

update public.supplier_inventory_items
set buying_price = unit_price
where buying_price = 0 and unit_price > 0;

update public.supplier_inventory_items
set selling_price = unit_price
where selling_price = 0 and unit_price > 0;

-- =====================================================================
-- Migration: 20260525113000_supplier_registration_and_client_notices.sql
-- =====================================================================

alter type public.member_category add value if not exists 'supplier';

alter table public.suppliers
  add column if not exists member_id text references public.members(id) on delete set null,
  add column if not exists supplier_type text not null default 'individual',
  add column if not exists registration_category text not null default 'goods',
  add column if not exists individual_first_name text,
  add column if not exists individual_second_name text,
  add column if not exists individual_third_name text,
  add column if not exists national_id text,
  add column if not exists gender text,
  add column if not exists date_of_birth date,
  add column if not exists business_registration_number text,
  add column if not exists registration_date date,
  add column if not exists contact_person_designation text,
  add column if not exists alternative_phone text,
  add column if not exists email text,
  add column if not exists postal_address text,
  add column if not exists postal_code_town text,
  add column if not exists county text,
  add column if not exists sub_county_town text,
  add column if not exists physical_location text,
  add column if not exists kra_pin text,
  add column if not exists tax_compliance_certificate_number text,
  add column if not exists agpo_category text not null default 'not_applicable',
  add column if not exists regulatory_license_number text,
  add column if not exists bank_name text,
  add column if not exists bank_branch text,
  add column if not exists account_name text,
  add column if not exists account_number text,
  add column if not exists mpesa_paybill_till text,
  add column if not exists document_checklist jsonb not null default '{}'::jsonb;

create unique index if not exists idx_suppliers_member_id on public.suppliers(member_id)
where member_id is not null;

create index if not exists idx_suppliers_compliance_lookup
on public.suppliers(kra_pin, business_registration_number);

alter table public.staff_memos
  add column if not exists audience text not null default 'staff',
  add column if not exists notice_kind text not null default 'info',
  add column if not exists expires_at date;

create index if not exists idx_staff_memos_client_audience
on public.staff_memos(audience, memo_date desc, expires_at);

-- =====================================================================
-- Migration: 20260525123000_supplier_portal_broker_people_and_targeted_notices.sql
-- =====================================================================

alter table public.suppliers
  add column if not exists supplier_class text not null default 'normal';

create index if not exists idx_suppliers_supplier_class
on public.suppliers(supplier_class, status);

create table if not exists public.supplier_broker_clients (
  id text primary key,
  supplier_id text not null references public.suppliers(id) on delete cascade,
  first_name text not null,
  second_name text,
  third_name text,
  national_id text,
  role text,
  phone text,
  opening_balance numeric(14,2) not null default 0,
  current_balance numeric(14,2) not null default 0,
  status text not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.supplier_broker_clients enable row level security;

create unique index if not exists idx_supplier_broker_clients_supplier_national_id
on public.supplier_broker_clients(supplier_id, national_id)
where national_id is not null and national_id <> '';

create index if not exists idx_supplier_broker_clients_supplier
on public.supplier_broker_clients(supplier_id, updated_at desc);

create table if not exists public.supplier_broker_client_transactions (
  id text primary key,
  supplier_client_id text not null references public.supplier_broker_clients(id) on delete cascade,
  supplier_id text not null references public.suppliers(id) on delete cascade,
  kind text not null check (kind in ('deposit', 'withdrawal')),
  amount numeric(14,2) not null check (amount > 0),
  balance_after numeric(14,2) not null,
  note text,
  recorded_by text,
  created_at timestamptz not null default now()
);

alter table public.supplier_broker_client_transactions enable row level security;

create index if not exists idx_supplier_broker_client_transactions_supplier
on public.supplier_broker_client_transactions(supplier_id, created_at desc);

create index if not exists idx_supplier_broker_client_transactions_client
on public.supplier_broker_client_transactions(supplier_client_id, created_at desc);

alter table public.staff_memos
  add column if not exists target_member_id text references public.members(id) on delete cascade,
  add column if not exists target_supplier_id text references public.suppliers(id) on delete cascade;

create index if not exists idx_staff_memos_target_member
on public.staff_memos(target_member_id, memo_date desc);

create index if not exists idx_staff_memos_target_supplier
on public.staff_memos(target_supplier_id, memo_date desc);

-- =====================================================================
-- Migration: 20260525133000_followups_allow_carryover_loans.sql
-- =====================================================================

alter table if exists public.followups
  drop constraint if exists followups_loan_id_fkey;

comment on column public.followups.loan_id is
  'References either public.loans.id or public.member_carryover_loans.id so active/defaulted carryover loans can be followed up.';

-- =====================================================================
-- Migration: 20260526100000_member_multi_roles_and_carryover_metadata.sql
-- =====================================================================

alter table public.members
  add column if not exists member_tags text[] not null default '{}'::text[];

update public.members
set member_tags = array_remove(array[
  case when member_category is not null then member_category::text else null end,
  case when coalesce(is_investor, false) then 'investor' else null end
], null)
where coalesce(array_length(member_tags, 1), 0) = 0;

create index if not exists idx_members_member_tags
on public.members using gin(member_tags);

comment on column public.members.member_tags is
  'Multi-role member flags such as member, investor, locomotive, stock, service, and supplier. member_category remains as the primary legacy category.';

alter table public.member_carryover_loans
  add column if not exists loan_kind text not null default 'financial';

comment on column public.member_carryover_loans.loan_kind is
  'Carryover product kind: financial, fuel, stock, or service. Product-specific metadata is stored in fee_breakdown.';

create index if not exists idx_member_carryover_loans_kind
on public.member_carryover_loans(loan_kind, member_id, start_date desc);

-- Migration: 20260527100000_loan_freeze_and_penalty_waivers.sql

alter table public.loans
  add column if not exists frozen_at date,
  add column if not exists frozen_note text,
  add column if not exists penalty_waived_amount numeric(14,2) not null default 0;

comment on column public.loans.frozen_at is
  'When set, follow-up aging and penalty calculations are frozen at this date.';

comment on column public.loans.penalty_waived_amount is
  'Director-approved waiver applied against calculated loan penalties.';

-- Migration: 20260527131500_member_vehicle_plate_for_locomotives.sql

alter table public.members
  add column if not exists vehicle_plate text;

create index if not exists idx_members_vehicle_plate
on public.members(vehicle_plate)
where vehicle_plate is not null;

comment on column public.members.vehicle_plate is
  'Default vehicle plate for locomotive members so fuel refill rows do not repeat the plate on every entry.';

-- =====================================================================
-- Migration: 20260528103000_one_open_loan_per_member_category.sql
-- =====================================================================

create or replace function public.tg_reject_duplicate_open_carryover_loan()
returns trigger
language plpgsql
as $$
declare
  normalized_kind text := coalesce(nullif(new.loan_kind, ''), 'financial');
begin
  if coalesce(new.finished, false) = true or new.status not in ('active', 'defaulted') then
    return new;
  end if;

  if exists (
    select 1
    from public.loans l
    where l.member_id = new.member_id
      and coalesce(nullif(l.loan_kind, ''), 'financial') = normalized_kind
      and l.status in ('pending', 'active', 'defaulted')
  ) then
    raise exception 'Member % already has an open % loan.', new.member_id, normalized_kind;
  end if;

  if exists (
    select 1
    from public.member_carryover_loans cl
    where cl.member_id = new.member_id
      and coalesce(nullif(cl.loan_kind, ''), 'financial') = normalized_kind
      and cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false
      and cl.id <> new.id
  ) then
    raise exception 'Member % already has an open % carryover loan.', new.member_id, normalized_kind;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_member_carryover_loans_reject_duplicate_open
on public.member_carryover_loans;

create trigger trg_member_carryover_loans_reject_duplicate_open
before insert or update of member_id, status, loan_kind, finished
on public.member_carryover_loans
for each row
execute function public.tg_reject_duplicate_open_carryover_loan();

create or replace view public.financial_invariant_violations as
with settings as (
  select
    public.sauti_policy_numeric('mandatorySavingsThreshold', 5000) as savings_threshold,
    public.sauti_policy_numeric('mandatorySharesThreshold', 3000) as shares_threshold
),
ledger_net as (
  select
    member_id,
    sum(
      case
        when type in ('deposit', 'loan_repayment', 'share_purchase', 'fee_payment', 'investor_contribution')
          then amount
        when type in ('withdrawal', 'loan_disbursement')
          then -amount
        else 0
      end
    ) as net_amount
  from public.transactions
  where member_id is not null
  group by member_id
),
carryover_net as (
  select
    member_id,
    greatest(
      coalesce(total_collected, 0),
      case
        when (collection_breakdown ->> 'totalDepositsRecorded') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then (collection_breakdown ->> 'totalDepositsRecorded')::numeric
        else 0
      end
    ) as net_amount
  from public.member_carryover_profiles
),
docket_totals as (
  select
    member_id,
    sum(amount) filter (where docket = 'purpose_pool') as purpose_pool,
    sum(amount) filter (where docket <> 'purpose_pool') as other_dockets
  from public.member_docket_balances
  group by member_id
),
member_positions as (
  select
    m.id as member_id,
    m.savings_balance,
    (m.shares * 100) + m.share_reserve_balance as share_basket,
    coalesce(d.purpose_pool, 0) as purpose_pool,
    coalesce(d.other_dockets, 0) as other_dockets,
    greatest(coalesce(l.net_amount, 0), coalesce(c.net_amount, 0)) as lifetime_net
  from public.members m
  left join ledger_net l on l.member_id = m.id
  left join carryover_net c on c.member_id = m.id
  left join docket_totals d on d.member_id = m.id
),
open_loans as (
  select
    id,
    member_id,
    coalesce(nullif(loan_kind, ''), 'financial') as loan_kind,
    'live'::text as source
  from public.loans
  where status in ('pending', 'active', 'defaulted')
  union all
  select
    id,
    member_id,
    coalesce(nullif(loan_kind, ''), 'financial') as loan_kind,
    'carryover'::text as source
  from public.member_carryover_loans
  where status in ('active', 'defaulted')
    and coalesce(finished, false) = false
),
duplicate_open_loans as (
  select
    member_id,
    loan_kind,
    jsonb_agg(jsonb_build_object('id', id, 'source', source) order by source, id) as loans
  from open_loans
  group by member_id, loan_kind
  having count(*) > 1
)
select
  'negative_member_balance'::text as violation,
  mp.member_id,
  jsonb_build_object(
    'savingsBalance', mp.savings_balance,
    'shareBasket', mp.share_basket
  ) as details
from member_positions mp
where mp.savings_balance < 0
   or mp.share_basket < 0
union all
select
  'mandatory_savings_above_threshold'::text as violation,
  mp.member_id,
  jsonb_build_object(
    'savingsBalance', mp.savings_balance,
    'threshold', s.savings_threshold
  ) as details
from member_positions mp
cross join settings s
where mp.savings_balance > s.savings_threshold
union all
select
  'shares_above_threshold'::text as violation,
  mp.member_id,
  jsonb_build_object(
    'shareBasket', mp.share_basket,
    'threshold', s.shares_threshold
  ) as details
from member_positions mp
cross join settings s
where mp.share_basket > s.shares_threshold
union all
select
  'purpose_pool_above_lifetime_net'::text as violation,
  mp.member_id,
  jsonb_build_object(
    'lifetimeNet', mp.lifetime_net,
    'mandatoryAndOtherHeld', mp.savings_balance + mp.share_basket + mp.other_dockets,
    'purposePool', mp.purpose_pool
  ) as details
from member_positions mp
where mp.purpose_pool > greatest(0, mp.lifetime_net - mp.savings_balance - mp.share_basket - mp.other_dockets)
union all
select
  'duplicate_open_loans'::text as violation,
  member_id,
  jsonb_build_object('loanKind', loan_kind, 'loans', loans) as details
from duplicate_open_loans;

-- =====================================================================
-- Migration: 20260528114500_penalty_rate_split_and_default_cap.sql
-- =====================================================================

update public.policy_settings
set value = jsonb_set(
  jsonb_set(
    coalesce(value, '{}'::jsonb),
    '{penaltyDailyPct}',
    '5'::jsonb,
    true
  ),
  '{defaultPenaltyPct}',
  '2'::jsonb,
  true
)
where key = 'percentages';

-- =====================================================================
-- Migration: 20260528130000_service_wallet_communications_and_requests.sql
-- =====================================================================

alter type public.member_docket add value if not exists 'service_wallet';

alter table public.staff_memos
  add column if not exists document_kind text not null default 'memo',
  add column if not exists letter_meta jsonb not null default '{}'::jsonb;

create index if not exists idx_staff_memos_document_kind
on public.staff_memos(document_kind, memo_date desc);

alter table public.members
  add column if not exists service_member_number text;

create unique index if not exists idx_members_service_member_number
on public.members(service_member_number)
where service_member_number is not null;

create table if not exists public.service_catalog (
  id text primary key,
  name text not null,
  description text,
  price numeric(14,2) not null default 0,
  billing_frequency text not null default 'monthly',
  scope text not null default 'all_members',
  selected_member_ids text[] not null default '{}'::text[],
  deduction_mode text not null default 'normal',
  fee_overrides jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by text references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_catalog_frequency_check
    check (billing_frequency in ('one_time','daily','weekly','monthly','yearly')),
  constraint service_catalog_scope_check
    check (scope in ('all_members','service_members','selected_members'))
);

alter table public.service_catalog enable row level security;

alter table public.service_catalog
  add column if not exists deduction_mode text not null default 'normal',
  add column if not exists fee_overrides jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.service_catalog
    add constraint service_catalog_deduction_mode_check
    check (deduction_mode in ('normal','override_all','amended_override'));
exception when duplicate_object then null;
end $$;

drop trigger if exists trg_service_catalog_updated_at on public.service_catalog;
create trigger trg_service_catalog_updated_at before update on public.service_catalog
  for each row execute function public.tg_set_updated_at();

create table if not exists public.member_service_subscriptions (
  member_id text not null references public.members(id) on delete cascade,
  service_id text not null references public.service_catalog(id) on delete cascade,
  status text not null default 'active',
  assigned_by text references public.staff(id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, service_id),
  constraint member_service_subscriptions_status_check
    check (status in ('active','paused','cancelled'))
);

alter table public.member_service_subscriptions enable row level security;

drop trigger if exists trg_member_service_subscriptions_updated_at
on public.member_service_subscriptions;
create trigger trg_member_service_subscriptions_updated_at
before update on public.member_service_subscriptions
for each row execute function public.tg_set_updated_at();

create index if not exists idx_member_service_subscriptions_service
on public.member_service_subscriptions(service_id, status);

create index if not exists idx_member_service_subscriptions_member
on public.member_service_subscriptions(member_id, status);

insert into public.fee_policies (
  key, label, amount, permanence, effective_from, scope, custom, notes
)
values (
  'sticker',
  'Member Buffer',
  3000,
  'permanent',
  current_date,
  'all',
  false,
  'Replaces the old shop sticker fee while keeping the sticker key for existing ledgers.'
)
on conflict (key) do update set
  label = excluded.label,
  amount = excluded.amount,
  permanence = excluded.permanence,
  effective_from = least(public.fee_policies.effective_from, excluded.effective_from),
  scope = excluded.scope,
  custom = excluded.custom,
  notes = excluded.notes,
  updated_at = now();

comment on column public.staff_memos.document_kind is
  'memo for normal notices, letter for member-downloadable letterhead documents.';

comment on column public.staff_memos.letter_meta is
  'Letterhead options, selected member facts, included fields, and delivery/download metadata.';

comment on column public.service_catalog.deduction_mode is
  'normal applies normal service deduction, override_all replaces other deductions, amended_override stores custom fee overrides.';

update public.policy_settings
set value = coalesce(value, '{}'::jsonb)
  || jsonb_build_object(
    'fuelBufferAmount', coalesce(value->'fuelBufferAmount', '3000'::jsonb),
    'fuelChargeAmount', coalesce(value->'fuelChargeAmount', '100'::jsonb),
    'stockChargeAmount', coalesce(value->'stockChargeAmount', '100'::jsonb)
  ),
  notes = coalesce(notes, '') || ' Configurable fuel buffer, fuel charge, and stock charge added.',
  updated_at = now()
where key = 'percentages';

-- =====================================================================
-- Migration: 20260529120000_sauti_ai_intelligence_platform.sql
-- =====================================================================

-- Sauti AI intelligence platform foundation.
-- This creates durable memory, conversation, file, research, agent, and call-session records.

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
create index if not exists ai_memories_tags_idx on public.ai_memories using gin(tags);
create index if not exists ai_observations_status_idx on public.ai_observations(status, severity, created_at desc);
create index if not exists ai_files_owner_idx on public.ai_files(owner_kind, owner_id, created_at desc);
create index if not exists ai_research_logs_created_idx on public.ai_research_logs(created_at desc);
create index if not exists ai_call_sessions_owner_idx on public.ai_call_sessions(owner_kind, owner_id, started_at desc);
create index if not exists ai_file_chunks_file_idx on public.ai_file_chunks(file_id, chunk_index);
create index if not exists ai_knowledge_links_source_idx on public.ai_knowledge_links(source_type, source_id);
create index if not exists ai_knowledge_links_target_idx on public.ai_knowledge_links(target_type, target_id);
create index if not exists ai_tool_permissions_tool_idx on public.ai_tool_permissions(tool_key, role);
create index if not exists ai_realtime_events_call_idx on public.ai_realtime_events(call_session_id, created_at desc);

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

drop policy if exists "Service role manages AI conversations" on public.ai_conversations;
create policy "Service role manages AI conversations"
on public.ai_conversations for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages AI messages" on public.ai_messages;
create policy "Service role manages AI messages"
on public.ai_messages for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages AI memories" on public.ai_memories;
create policy "Service role manages AI memories"
on public.ai_memories for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages AI observations" on public.ai_observations;
create policy "Service role manages AI observations"
on public.ai_observations for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages AI files" on public.ai_files;
create policy "Service role manages AI files"
on public.ai_files for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages AI research logs" on public.ai_research_logs;
create policy "Service role manages AI research logs"
on public.ai_research_logs for all
to service_role
using (true)
with check (true);

drop policy if exists "Authenticated users read enabled AI agents" on public.ai_agents;
create policy "Authenticated users read enabled AI agents"
on public.ai_agents for select
to authenticated
using (enabled = true);

drop policy if exists "Service role manages AI agents" on public.ai_agents;
create policy "Service role manages AI agents"
on public.ai_agents for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages AI call sessions" on public.ai_call_sessions;
create policy "Service role manages AI call sessions"
on public.ai_call_sessions for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages AI file chunks" on public.ai_file_chunks;
create policy "Service role manages AI file chunks"
on public.ai_file_chunks for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages AI knowledge links" on public.ai_knowledge_links;
create policy "Service role manages AI knowledge links"
on public.ai_knowledge_links for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages AI tool permissions" on public.ai_tool_permissions;
create policy "Service role manages AI tool permissions"
on public.ai_tool_permissions for all
to service_role
using (true)
with check (true);

drop policy if exists "Service role manages AI realtime events" on public.ai_realtime_events;
create policy "Service role manages AI realtime events"
on public.ai_realtime_events for all
to service_role
using (true)
with check (true);

drop trigger if exists touch_ai_conversations_updated_at on public.ai_conversations;
create trigger touch_ai_conversations_updated_at
before update on public.ai_conversations
for each row execute function public.touch_updated_at();

drop trigger if exists touch_ai_memories_updated_at on public.ai_memories;
create trigger touch_ai_memories_updated_at
before update on public.ai_memories
for each row execute function public.touch_updated_at();

drop trigger if exists touch_ai_observations_updated_at on public.ai_observations;
create trigger touch_ai_observations_updated_at
before update on public.ai_observations
for each row execute function public.touch_updated_at();

drop trigger if exists touch_ai_files_updated_at on public.ai_files;
create trigger touch_ai_files_updated_at
before update on public.ai_files
for each row execute function public.touch_updated_at();

drop trigger if exists touch_ai_agents_updated_at on public.ai_agents;
create trigger touch_ai_agents_updated_at
before update on public.ai_agents
for each row execute function public.touch_updated_at();

drop trigger if exists touch_ai_tool_permissions_updated_at on public.ai_tool_permissions;
create trigger touch_ai_tool_permissions_updated_at
before update on public.ai_tool_permissions
for each row execute function public.touch_updated_at();

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

insert into public.ai_tool_permissions (id, tool_key, role, enabled, requires_approval, metadata)
values
  ('AITP-DIRECTOR-BROWSE', 'controlled_browsing', 'director', true, true, '{"purpose":"Allow directors to approve external research and store verified discoveries."}'::jsonb),
  ('AITP-MANAGER-BROWSE', 'controlled_browsing', 'manager', false, true, '{"purpose":"Managers can request external research but need director approval before memory storage."}'::jsonb),
  ('AITP-STAFF-BROWSE', 'controlled_browsing', 'loan_officer', false, true, '{"purpose":"Staff can log research requests only."}'::jsonb),
  ('AITP-DIRECTOR-MEMORY', 'organization_memory', 'director', true, false, '{"purpose":"Directors may approve organization-wide AI memory."}'::jsonb),
  ('AITP-MANAGER-MEMORY', 'team_memory', 'manager', true, true, '{"purpose":"Managers may propose team memory subject to approval."}'::jsonb),
  ('AITP-STAFF-CALL', 'ai_call_mode', 'loan_officer', true, false, '{"purpose":"Staff may use browser audio, camera, and screen capture AI sessions."}'::jsonb),
  ('AITP-DIRECTOR-FILE', 'file_intelligence', 'director', true, false, '{"purpose":"Directors may process uploaded files into AI knowledge."}'::jsonb),
  ('AITP-STAFF-FILE', 'file_intelligence', 'loan_officer', true, true, '{"purpose":"Staff file ingestion is logged and reviewable."}'::jsonb)
on conflict (tool_key, role) do update set
  enabled = excluded.enabled,
  requires_approval = excluded.requires_approval,
  metadata = excluded.metadata,
  updated_at = now();

notify pgrst, 'reload schema';

-- =====================================================================
-- Migration: 20260529133000_ai_schema_cache_and_loan_duplicate_repair.sql
-- =====================================================================

-- Repair duplicate open loan-category records and refresh PostgREST's schema cache.
-- Business rule: a member may have only one unfinished loan per category.

create or replace function public.sauti_live_loan_settlement_amount(loan_row public.loans)
returns numeric
language sql
stable
as $$
  select greatest(
    0,
    coalesce(
      loan_row.financed_principal_amount,
      loan_row.approved_amount,
      loan_row.principal,
      0
    )
  );
$$;

create or replace function public.sauti_carryover_loan_settlement_amount(loan_row public.member_carryover_loans)
returns numeric
language sql
stable
as $$
  select greatest(
    0,
    coalesce(loan_row.principal, 0)
    + case
        when coalesce(nullif(loan_row.loan_kind, ''), 'financial') in ('fuel', 'stock', 'service') then
          coalesce(nullif(loan_row.fee_breakdown ->> 'processingFeeAmount', '')::numeric, 0)
        else
          coalesce(nullif(loan_row.fee_breakdown ->> 'processingFeeAmount', '')::numeric, 0)
          + coalesce(nullif(loan_row.fee_breakdown ->> 'insuranceFeeAmount', '')::numeric, 0)
          + coalesce(nullif(loan_row.fee_breakdown ->> 'transactionFeeAmount', '')::numeric, 0)
          + (coalesce(loan_row.principal, 0) * coalesce(loan_row.interest_rate_pct, 0) / 100)
          + coalesce(loan_row.daily_savings_amount, 0) * greatest(1, coalesce(loan_row.term_days, 1))
      end
  );
$$;

create or replace function public.sauti_carryover_prior_penalty_amount(loan_row public.member_carryover_loans)
returns numeric
language sql
stable
as $$
  select greatest(
    0,
    coalesce(nullif(loan_row.fee_breakdown ->> 'priorPenaltyAmount', '')::numeric, 0)
    + coalesce(nullif(loan_row.fee_breakdown ->> 'manualPenaltyAmount', '')::numeric, 0)
    + coalesce(nullif(loan_row.fee_breakdown ->> 'carriedForwardPenaltyAmount', '')::numeric, 0)
  );
$$;

create or replace function public.sauti_repair_duplicate_open_loan_categories()
returns table (
  source_table text,
  member_id text,
  loan_kind text,
  kept_loan_id text,
  closed_loan_ids text[],
  closed_count integer
)
language plpgsql
as $$
declare
  group_row record;
  loan_ids text[];
  duplicate_ids text[];
  latest_source text;
  latest_id text;
begin
  for group_row in
    select
      l.member_id,
      coalesce(nullif(l.loan_kind, ''), 'financial') as loan_kind
    from public.loans l
    where l.status in ('pending', 'active', 'defaulted')
    group by l.member_id, coalesce(nullif(l.loan_kind, ''), 'financial')
    having count(*) > 1
  loop
    select array_agg(l.id order by l.start_date desc nulls last, l.created_at desc nulls last, l.id desc)
      into loan_ids
    from public.loans l
    where l.member_id = group_row.member_id
      and coalesce(nullif(l.loan_kind, ''), 'financial') = group_row.loan_kind
      and l.status in ('pending', 'active', 'defaulted');

    kept_loan_id := loan_ids[1];
    duplicate_ids := loan_ids[2:cardinality(loan_ids)];

    update public.loans duplicate
    set
      status = 'closed',
      paid = greatest(coalesce(duplicate.paid, 0), public.sauti_live_loan_settlement_amount(duplicate)),
      supplier_payload = coalesce(duplicate.supplier_payload, '{}'::jsonb) || jsonb_build_object(
        'closedAsEarlierCycleBeforeLoanId', kept_loan_id,
        'closedFromLifetimeNetAt', now()
      ),
      updated_at = now()
    where duplicate.id = any(duplicate_ids);

    source_table := 'loans';
    member_id := group_row.member_id;
    loan_kind := group_row.loan_kind;
    closed_loan_ids := duplicate_ids;
    closed_count := cardinality(duplicate_ids);
    return next;
  end loop;

  for group_row in
    select
      cl.member_id,
      coalesce(nullif(cl.loan_kind, ''), 'financial') as loan_kind
    from public.member_carryover_loans cl
    where cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false
    group by cl.member_id, coalesce(nullif(cl.loan_kind, ''), 'financial')
    having count(*) > 1
  loop
    select array_agg(cl.id order by cl.start_date desc nulls last, cl.created_at desc nulls last, cl.id desc)
      into loan_ids
    from public.member_carryover_loans cl
    where cl.member_id = group_row.member_id
      and coalesce(nullif(cl.loan_kind, ''), 'financial') = group_row.loan_kind
      and cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false;

    kept_loan_id := loan_ids[1];
    duplicate_ids := loan_ids[2:cardinality(loan_ids)];

    update public.member_carryover_loans duplicate
    set
      status = 'closed',
      finished = true,
      closed_on = coalesce(duplicate.closed_on, duplicate.due_date, current_date),
      paid_to_date = greatest(
        coalesce(duplicate.paid_to_date, 0),
        public.sauti_carryover_loan_settlement_amount(duplicate)
      ),
      penalty_waived_amount = greatest(
        coalesce(duplicate.penalty_waived_amount, 0),
        public.sauti_carryover_prior_penalty_amount(duplicate)
      ),
      fee_breakdown = coalesce(duplicate.fee_breakdown, '{}'::jsonb) || jsonb_build_object(
        'closedAsEarlierCycleBeforeCarryoverId', kept_loan_id,
        'closedFromLifetimeNetAt', now()
      ),
      notes = concat_ws(E'\n', duplicate.notes, 'System closed older same-category cycle from lifetime net before ' || kept_loan_id),
      updated_at = now()
    where duplicate.id = any(duplicate_ids);

    source_table := 'member_carryover_loans';
    member_id := group_row.member_id;
    loan_kind := group_row.loan_kind;
    closed_loan_ids := duplicate_ids;
    closed_count := cardinality(duplicate_ids);
    return next;
  end loop;

  for group_row in
    with open_cycles as (
      select
        'loans'::text as source,
        l.id,
        l.member_id,
        coalesce(nullif(l.loan_kind, ''), 'financial') as loan_kind,
        l.start_date,
        l.created_at
      from public.loans l
      where l.status in ('pending', 'active', 'defaulted')
      union all
      select
        'member_carryover_loans'::text as source,
        cl.id,
        cl.member_id,
        coalesce(nullif(cl.loan_kind, ''), 'financial') as loan_kind,
        cl.start_date,
        cl.created_at
      from public.member_carryover_loans cl
      where cl.status in ('active', 'defaulted')
        and coalesce(cl.finished, false) = false
    ),
    grouped as (
      select
        oc.member_id,
        oc.loan_kind,
        array_agg(oc.source order by oc.start_date desc nulls last, oc.created_at desc nulls last, oc.id desc) as sources,
        array_agg(oc.id order by oc.start_date desc nulls last, oc.created_at desc nulls last, oc.id desc) as ids
      from open_cycles oc
      group by oc.member_id, oc.loan_kind
      having count(*) > 1
    )
    select * from grouped
  loop
    latest_source := group_row.sources[1];
    latest_id := group_row.ids[1];
    kept_loan_id := latest_id;
    duplicate_ids := group_row.ids[2:cardinality(group_row.ids)];

    update public.loans duplicate
    set
      status = 'closed',
      paid = greatest(coalesce(duplicate.paid, 0), public.sauti_live_loan_settlement_amount(duplicate)),
      supplier_payload = coalesce(duplicate.supplier_payload, '{}'::jsonb) || jsonb_build_object(
        'closedAsEarlierCycleBeforeSource', latest_source,
        'closedAsEarlierCycleBeforeId', latest_id,
        'closedFromLifetimeNetAt', now()
      ),
      updated_at = now()
    where duplicate.id = any(duplicate_ids)
      and duplicate.id <> latest_id;

    update public.member_carryover_loans duplicate
    set
      status = 'closed',
      finished = true,
      closed_on = coalesce(duplicate.closed_on, duplicate.due_date, current_date),
      paid_to_date = greatest(
        coalesce(duplicate.paid_to_date, 0),
        public.sauti_carryover_loan_settlement_amount(duplicate)
      ),
      penalty_waived_amount = greatest(
        coalesce(duplicate.penalty_waived_amount, 0),
        public.sauti_carryover_prior_penalty_amount(duplicate)
      ),
      fee_breakdown = coalesce(duplicate.fee_breakdown, '{}'::jsonb) || jsonb_build_object(
        'closedAsEarlierCycleBeforeSource', latest_source,
        'closedAsEarlierCycleBeforeId', latest_id,
        'closedFromLifetimeNetAt', now()
      ),
      notes = concat_ws(E'\n', duplicate.notes, 'System closed older same-category cycle from lifetime net before ' || latest_id),
      updated_at = now()
    where duplicate.id = any(duplicate_ids)
      and duplicate.id <> latest_id;

    source_table := 'loans/member_carryover_loans';
    member_id := group_row.member_id;
    loan_kind := group_row.loan_kind;
    closed_loan_ids := duplicate_ids;
    closed_count := cardinality(duplicate_ids);
    return next;
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.loans'::regclass
      and tgname = 'trg_loans_reject_duplicate_open'
      and not tgisinternal
  ) then
    alter table public.loans disable trigger trg_loans_reject_duplicate_open;
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.member_carryover_loans'::regclass
      and tgname = 'trg_member_carryover_loans_reject_duplicate_open'
      and not tgisinternal
  ) then
    alter table public.member_carryover_loans disable trigger trg_member_carryover_loans_reject_duplicate_open;
  end if;
end $$;

select * from public.sauti_repair_duplicate_open_loan_categories();

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.loans'::regclass
      and tgname = 'trg_loans_reject_duplicate_open'
      and not tgisinternal
  ) then
    alter table public.loans enable trigger trg_loans_reject_duplicate_open;
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.member_carryover_loans'::regclass
      and tgname = 'trg_member_carryover_loans_reject_duplicate_open'
      and not tgisinternal
  ) then
    alter table public.member_carryover_loans enable trigger trg_member_carryover_loans_reject_duplicate_open;
  end if;
end $$;

drop index if exists public.loans_one_open_per_member_kind_idx;
create unique index loans_one_open_per_member_kind_idx
on public.loans (member_id, (coalesce(nullif(loan_kind, ''), 'financial')))
where status in ('pending', 'active', 'defaulted');

drop index if exists public.member_carryover_loans_one_open_per_member_kind_idx;
create unique index member_carryover_loans_one_open_per_member_kind_idx
on public.member_carryover_loans (member_id, (coalesce(nullif(loan_kind, ''), 'financial')))
where status in ('active', 'defaulted')
  and coalesce(finished, false) = false;

create or replace function public.tg_reject_duplicate_open_live_loan()
returns trigger
language plpgsql
as $$
declare
  normalized_kind text := coalesce(nullif(new.loan_kind, ''), 'financial');
begin
  if new.status not in ('pending', 'active', 'defaulted') then
    return new;
  end if;

  if exists (
    select 1
    from public.loans l
    where l.member_id = new.member_id
      and coalesce(nullif(l.loan_kind, ''), 'financial') = normalized_kind
      and l.status in ('pending', 'active', 'defaulted')
      and l.id <> new.id
  ) then
    raise exception 'Member % already has an open % loan.', new.member_id, normalized_kind;
  end if;

  if exists (
    select 1
    from public.member_carryover_loans cl
    where cl.member_id = new.member_id
      and coalesce(nullif(cl.loan_kind, ''), 'financial') = normalized_kind
      and cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false
  ) then
    raise exception 'Member % already has an open % carryover loan.', new.member_id, normalized_kind;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_loans_reject_duplicate_open on public.loans;
create trigger trg_loans_reject_duplicate_open
before insert or update of member_id, status, loan_kind
on public.loans
for each row
execute function public.tg_reject_duplicate_open_live_loan();

create or replace function public.tg_reject_duplicate_open_carryover_loan()
returns trigger
language plpgsql
as $$
declare
  normalized_kind text := coalesce(nullif(new.loan_kind, ''), 'financial');
begin
  if coalesce(new.finished, false) = true or new.status not in ('active', 'defaulted') then
    return new;
  end if;

  if exists (
    select 1
    from public.loans l
    where l.member_id = new.member_id
      and coalesce(nullif(l.loan_kind, ''), 'financial') = normalized_kind
      and l.status in ('pending', 'active', 'defaulted')
  ) then
    raise exception 'Member % already has an open % loan.', new.member_id, normalized_kind;
  end if;

  if exists (
    select 1
    from public.member_carryover_loans cl
    where cl.member_id = new.member_id
      and coalesce(nullif(cl.loan_kind, ''), 'financial') = normalized_kind
      and cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false
      and cl.id <> new.id
  ) then
    raise exception 'Member % already has an open % carryover loan.', new.member_id, normalized_kind;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_member_carryover_loans_reject_duplicate_open
on public.member_carryover_loans;

create trigger trg_member_carryover_loans_reject_duplicate_open
before insert or update of member_id, status, loan_kind, finished
on public.member_carryover_loans
for each row
execute function public.tg_reject_duplicate_open_carryover_loan();

notify pgrst, 'reload schema';

-- =====================================================================
-- Migration: 20260529134500_interest_rates_by_loan_category.sql
-- =====================================================================

with current_interest as (
  select
    coalesce(value #>> '{standard,7}', value ->> '7', '10')::numeric as standard_7_rate,
    coalesce(value #>> '{standard,14}', value #>> '{standard,7}', value ->> '14', value ->> '7', '10')::numeric as standard_14_rate,
    coalesce(value #>> '{standard,30}', value #>> '{standard,14}', value #>> '{standard,7}', value ->> '30', value ->> '14', value ->> '7', '10')::numeric as standard_30_rate,
    coalesce(value #>> '{premium,14}', value ->> '14', '15')::numeric as premium_14_rate,
    coalesce(value #>> '{premium,30}', value #>> '{premium,14}', value ->> '30', value ->> '14', '15')::numeric as premium_30_rate,
    coalesce(value #>> '{premium,60}', value #>> '{premium,30}', value #>> '{premium,14}', value ->> '60', value ->> '30', value ->> '14', '15')::numeric as premium_60_rate,
    coalesce(value #>> '{premium,90}', value #>> '{premium,60}', value #>> '{premium,30}', value #>> '{premium,14}', value ->> '90', value ->> '60', value ->> '30', value ->> '14', '15')::numeric as premium_90_rate
  from public.policy_settings
  where key = 'interest_rates'
),
resolved_interest as (
  select
    coalesce((select standard_7_rate from current_interest), 10) as standard_7_rate,
    coalesce((select standard_14_rate from current_interest), 10) as standard_14_rate,
    coalesce((select standard_30_rate from current_interest), 10) as standard_30_rate,
    coalesce((select premium_14_rate from current_interest), 15) as premium_14_rate,
    coalesce((select premium_30_rate from current_interest), 15) as premium_30_rate,
    coalesce((select premium_60_rate from current_interest), 15) as premium_60_rate,
    coalesce((select premium_90_rate from current_interest), 15) as premium_90_rate
)
insert into public.policy_settings (key, label, value, notes)
select
  'interest_rates',
  'Interest rates by loan category',
  jsonb_build_object(
    'standard', jsonb_build_object(
      '7', standard_7_rate,
      '14', standard_14_rate,
      '30', standard_30_rate
    ),
    'premium', jsonb_build_object(
      '14', premium_14_rate,
      '30', premium_30_rate,
      '60', premium_60_rate,
      '90', premium_90_rate
    )
  ),
  'Interest percentages are configured by loan category and day bucket. Interest is calculated from net disbursed amount using the rate for the selected repayment days.'
from resolved_interest
on conflict (key) do update
set
  label = excluded.label,
  value = excluded.value,
  notes = excluded.notes,
  updated_at = now();

-- =====================================================================
-- Migration: 20260529140000_service_registration_application_wallet_foundation.sql
-- =====================================================================

-- Foundation for the SBC service registration/application guide:
-- service metadata, county schedules, applications, billing, wallets, contributions, and transport groups.

alter table public.service_catalog
  add column if not exists service_category text,
  add column if not exists eligibility_rules jsonb not null default '{}'::jsonb,
  add column if not exists effective_date date not null default current_date,
  add column if not exists expiry_date date,
  add column if not exists registration_fee numeric(14,2) not null default 0,
  add column if not exists processing_fee numeric(14,2) not null default 0,
  add column if not exists service_charge numeric(14,2) not null default 0,
  add column if not exists waiver_amount numeric(14,2) not null default 0,
  add column if not exists penalty_amount numeric(14,2) not null default 0,
  add column if not exists custom_charges jsonb not null default '[]'::jsonb,
  add column if not exists negotiated_discount_amount numeric(14,2) not null default 0,
  add column if not exists normal_deductions jsonb not null default '{}'::jsonb,
  add column if not exists grace_period_days integer not null default 0,
  add column if not exists renewal_rules jsonb not null default '{}'::jsonb;

alter table public.service_catalog
  drop constraint if exists service_catalog_frequency_check;

alter table public.service_catalog
  add constraint service_catalog_frequency_check
  check (
    billing_frequency in (
      'one_time',
      'daily',
      'weekly',
      'monthly',
      'quarterly',
      'semi_annual',
      'annual',
      'yearly',
      'seasonal',
      'custom'
    )
  );

alter table public.service_catalog
  drop constraint if exists service_catalog_scope_check;

alter table public.service_catalog
  add constraint service_catalog_scope_check
  check (scope in ('all_members','sbc_members','service_members','selected_members'));

create table if not exists public.county_charge_schedules (
  id text primary key,
  county text not null default 'Kiambu',
  schedule_version text not null default 'default',
  code text not null,
  description text not null,
  business_type text,
  fire_amount numeric(14,2) not null default 0,
  sw_amount numeric(14,2) not null default 0,
  sbp_amount numeric(14,2) not null default 0,
  app_amount numeric(14,2) not null default 0,
  pho_amount numeric(14,2) not null default 0,
  pho_inspection_amount numeric(14,2) not null default 0,
  other_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) generated always as (
    fire_amount + sw_amount + sbp_amount + app_amount + pho_amount + pho_inspection_amount + other_amount
  ) stored,
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (county, schedule_version, code)
);

alter table public.county_charge_schedules enable row level security;

drop trigger if exists trg_county_charge_schedules_updated_at on public.county_charge_schedules;
create trigger trg_county_charge_schedules_updated_at before update on public.county_charge_schedules
  for each row execute function public.tg_set_updated_at();

create table if not exists public.service_applications (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  service_id text references public.service_catalog(id) on delete set null,
  application_number text not null unique,
  service_type text,
  case_type text not null default 'normal',
  priority text not null default 'normal',
  problem_reason text,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  county text,
  subcounty text,
  ward text,
  town text,
  schedule_id text references public.county_charge_schedules(id) on delete set null,
  invoice_reference text,
  invoice_number text,
  invoice_date date,
  invoice_amount_charged numeric(14,2) not null default 0,
  issue_date date,
  expiry_date date,
  renewal_window_days integer not null default 0,
  grace_period_days integer not null default 0,
  confiscation_reference text,
  inventory_sheet_number text,
  confiscation_date date,
  status text not null default 'submitted',
  payment_status text not null default 'pending',
  workflow_stage text not null default 'application_submitted',
  calculated_charges jsonb not null default '{}'::jsonb,
  created_by text references public.staff(id) on delete set null,
  assigned_to text references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_applications_case_type_check
    check (case_type in ('normal','overcharged_invoice','invoice_with_penalty','confiscated_items')),
  constraint service_applications_priority_check
    check (priority in ('low','normal','high','urgent')),
  constraint service_applications_status_check
    check (status in ('submitted','verification','financial_review','waiver_approval','final_approval','billing','processing','completed','cancelled','under_review')),
  constraint service_applications_payment_status_check
    check (payment_status in ('pending','partially_paid','paid','waived','cancelled','under_review')),
  constraint service_applications_workflow_stage_check
    check (workflow_stage in ('application_submitted','verification','financial_review','waiver_approval','final_approval','billing','service_processing','completed'))
);

alter table public.service_applications enable row level security;

alter table public.members
  add column if not exists linked_previous_number text,
  add column if not exists previous_service_member_number text,
  add column if not exists alternative_phone text,
  add column if not exists email text,
  add column if not exists gender text,
  add column if not exists date_of_birth date,
  add column if not exists county text,
  add column if not exists subcounty text,
  add column if not exists ward text,
  add column if not exists town text,
  add column if not exists physical_address text,
  add column if not exists next_of_kin text,
  add column if not exists next_of_kin_contact text,
  add column if not exists passport_photo_url text,
  add column if not exists business_category_code text,
  add column if not exists business_description text,
  add column if not exists number_of_employees integer,
  add column if not exists kra_pin text,
  add column if not exists business_permit_number text,
  add column if not exists locomotive_details jsonb not null default '{}'::jsonb,
  add column if not exists operation_location jsonb not null default '{}'::jsonb,
  add column if not exists contribution_frequency text not null default 'monthly',
  add column if not exists service_member_upgraded_at timestamptz;

alter table public.members
  drop constraint if exists members_contribution_frequency_check;

alter table public.members
  add constraint members_contribution_frequency_check
  check (contribution_frequency in ('one_time','daily','weekly','monthly','annual','yearly','seasonal','custom'));

drop trigger if exists trg_service_applications_updated_at on public.service_applications;
create trigger trg_service_applications_updated_at before update on public.service_applications
  for each row execute function public.tg_set_updated_at();

create index if not exists idx_service_applications_member
on public.service_applications(member_id, created_at desc);

create index if not exists idx_service_applications_status
on public.service_applications(status, payment_status, created_at desc);

create table if not exists public.service_billing_invoices (
  id text primary key,
  application_id text references public.service_applications(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  service_id text references public.service_catalog(id) on delete set null,
  invoice_number text not null unique,
  county_charges numeric(14,2) not null default 0,
  service_fee numeric(14,2) not null default 0,
  processing_fee numeric(14,2) not null default 0,
  registration_fee numeric(14,2) not null default 0,
  custom_charges numeric(14,2) not null default 0,
  penalty_amount numeric(14,2) not null default 0,
  waiver_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  expected_amount numeric(14,2) not null default 0,
  invoice_amount_charged numeric(14,2) not null default 0,
  overcharge_amount numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0,
  status text not null default 'pending',
  due_date date,
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_billing_invoices_status_check
    check (status in ('pending','partially_paid','paid','waived','cancelled','under_review'))
);

alter table public.service_billing_invoices enable row level security;

drop trigger if exists trg_service_billing_invoices_updated_at on public.service_billing_invoices;
create trigger trg_service_billing_invoices_updated_at before update on public.service_billing_invoices
  for each row execute function public.tg_set_updated_at();

create index if not exists idx_service_billing_invoices_member
on public.service_billing_invoices(member_id, issued_at desc);

create table if not exists public.member_wallets (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  wallet_type text not null default 'service_wallet',
  balance numeric(14,2) not null default 0,
  withdrawable_balance numeric(14,2) not null default 0,
  reserved_balance numeric(14,2) not null default 0,
  locked_balance numeric(14,2) not null default 0,
  reserve_rules jsonb not null default '{}'::jsonb,
  risk_rating text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, wallet_type),
  constraint member_wallets_wallet_type_check
    check (wallet_type in ('individual','collective','contribution','welfare','service_wallet')),
  constraint member_wallets_nonnegative_check
    check (balance >= 0 and withdrawable_balance >= 0 and reserved_balance >= 0 and locked_balance >= 0)
);

alter table public.member_wallets enable row level security;

drop trigger if exists trg_member_wallets_updated_at on public.member_wallets;
create trigger trg_member_wallets_updated_at before update on public.member_wallets
  for each row execute function public.tg_set_updated_at();

create table if not exists public.member_contributions (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  contribution_type text not null,
  purpose_pool text,
  amount numeric(14,2) not null default 0,
  frequency text not null default 'monthly',
  status text not null default 'posted',
  posted_by text references public.staff(id) on delete set null,
  posted_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  constraint member_contributions_frequency_check
    check (frequency in ('one_time','daily','weekly','monthly','quarterly','semi_annual','annual','yearly','seasonal','custom')),
  constraint member_contributions_status_check
    check (status in ('expected','posted','missed','waived','reversed'))
);

alter table public.member_contributions enable row level security;

create index if not exists idx_member_contributions_member
on public.member_contributions(member_id, posted_at desc);

create table if not exists public.purpose_pools (
  id text primary key,
  name text not null,
  pool_type text not null,
  frequency text not null default 'monthly',
  support_percentage numeric(6,2) not null default 0,
  eligibility_rules jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purpose_pools_frequency_check
    check (frequency in ('one_time','daily','weekly','monthly','annual','yearly','seasonal','custom')),
  constraint purpose_pools_support_percentage_check
    check (support_percentage >= 0 and support_percentage <= 100)
);

alter table public.purpose_pools enable row level security;

drop trigger if exists trg_purpose_pools_updated_at on public.purpose_pools;
create trigger trg_purpose_pools_updated_at before update on public.purpose_pools
  for each row execute function public.tg_set_updated_at();

create table if not exists public.member_wallet_transactions (
  id text primary key,
  wallet_id text references public.member_wallets(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  group_id text,
  transaction_type text not null,
  amount numeric(14,2) not null default 0,
  balance_before numeric(14,2) not null default 0,
  balance_after numeric(14,2) not null default 0,
  purpose_pool_id text references public.purpose_pools(id) on delete set null,
  officer_id text references public.staff(id) on delete set null,
  reference text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint member_wallet_transactions_type_check
    check (transaction_type in ('deposit','withdrawal','reserve','release_reserve','lock','unlock','service_payment','welfare_support','adjustment'))
);

alter table public.member_wallet_transactions enable row level security;

create index if not exists idx_member_wallet_transactions_member
on public.member_wallet_transactions(member_id, created_at desc);

create table if not exists public.transport_groups (
  id text primary key,
  group_number text not null unique,
  group_type text not null,
  group_name text not null,
  route_stage text,
  sacco_association text,
  county text,
  subcounty text,
  ward text,
  town_stage text,
  status text not null default 'active',
  officer_assignments jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_groups_status_check
    check (status in ('active','inactive','suspended'))
);

alter table public.transport_groups enable row level security;

drop trigger if exists trg_transport_groups_updated_at on public.transport_groups;
create trigger trg_transport_groups_updated_at before update on public.transport_groups
  for each row execute function public.tg_set_updated_at();

do $$
begin
  alter table public.member_wallet_transactions
    add constraint member_wallet_transactions_group_id_fkey
    foreign key (group_id) references public.transport_groups(id) on delete set null;
exception when duplicate_object then null;
end $$;

create table if not exists public.transport_group_members (
  id text primary key,
  group_id text not null references public.transport_groups(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  role text not null default 'driver',
  vehicle_assigned text,
  route_assigned text,
  stage_assigned text,
  sacco_assigned text,
  status text not null default 'active',
  joined_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, member_id),
  constraint transport_group_members_role_check
    check (role in ('driver','conductor','crew','owner','officer')),
  constraint transport_group_members_status_check
    check (status in ('active','inactive','suspended'))
);

alter table public.transport_group_members enable row level security;

drop trigger if exists trg_transport_group_members_updated_at on public.transport_group_members;
create trigger trg_transport_group_members_updated_at before update on public.transport_group_members
  for each row execute function public.tg_set_updated_at();

create table if not exists public.collection_officer_commissions (
  id text primary key,
  officer_id text not null references public.staff(id) on delete cascade,
  group_id text references public.transport_groups(id) on delete set null,
  period_start date not null,
  period_end date not null,
  collection_amount numeric(14,2) not null default 0,
  savings_growth_amount numeric(14,2) not null default 0,
  service_conversion_count integer not null default 0,
  target_amount numeric(14,2) not null default 0,
  commission_amount numeric(14,2) not null default 0,
  status text not null default 'pending',
  calculated_at timestamptz not null default now(),
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint collection_officer_commissions_status_check
    check (status in ('pending','approved','paid','cancelled'))
);

alter table public.collection_officer_commissions enable row level security;

create table if not exists public.county_admin_locations (
  id text primary key,
  county text not null,
  subcounty text not null,
  ward text not null,
  towns text[] not null default '{}'::text[],
  active boolean not null default true,
  unique (county, subcounty, ward)
);

alter table public.county_admin_locations enable row level security;

create or replace view public.service_module_dashboard as
select
  (select count(*) from public.members where coalesce(member_tags, '{}'::text[]) @> array['service']::text[]) as total_service_members,
  (select count(*) from public.members where coalesce(member_tags, '{}'::text[]) @> array['member']::text[]) as total_sbc_members,
  (select count(*) from public.service_catalog where active = true) as active_services,
  (select count(*) from public.service_applications where status not in ('completed','cancelled')) as pending_applications,
  (select coalesce(sum(final_amount), 0) from public.service_billing_invoices where status in ('paid','partially_paid')) as revenue_collected,
  (select coalesce(sum(balance), 0) from public.member_wallets) as wallet_balances,
  (select coalesce(sum(waiver_amount), 0) from public.service_billing_invoices) as waivers_issued,
  (select coalesce(sum(penalty_amount), 0) from public.service_billing_invoices) as penalties_charged;

create or replace view public.service_member_reports as
select
  m.id,
  coalesce(m.service_member_number, m.id) as service_member_number,
  m.name,
  m.phone,
  m.member_category::text as member_category,
  m.member_tags,
  m.linked_previous_number,
  m.previous_service_member_number,
  coalesce(sum(w.balance), 0) as wallet_balance,
  count(distinct sa.id) as service_application_count,
  count(distinct mc.id) as contribution_count
from public.members m
left join public.member_wallets w on w.member_id = m.id
left join public.service_applications sa on sa.member_id = m.id
left join public.member_contributions mc on mc.member_id = m.id
group by m.id;

insert into public.county_charge_schedules (
  id, county, schedule_version, code, description, business_type,
  fire_amount, sw_amount, sbp_amount, app_amount, pho_amount, pho_inspection_amount
)
values
  ('KIA-SBP-001', 'Kiambu', 'default', 'SBP-001', 'General small business permit', 'permanent', 0, 0, 0, 0, 0, 0),
  ('KIA-TRN-001', 'Kiambu', 'default', 'TRN-001', 'Transport route/stage service', 'locomotive', 0, 0, 0, 0, 0, 0)
on conflict (county, schedule_version, code) do nothing;

insert into public.county_admin_locations (id, county, subcounty, ward, towns)
values
  ('KIA-THIKA-TOWNSHIP', 'Kiambu', 'Thika Town', 'Township', array['Thika CBD','Makongeni','Section 9']),
  ('KIA-RUIRU-BIASHARA', 'Kiambu', 'Ruiru', 'Biashara', array['Ruiru Town','Kwa Kairu','Kimbo']),
  ('KIA-KIAMBU-TOWNSHIP', 'Kiambu', 'Kiambu', 'Township', array['Kiambu Town','Ndumberi','Riabai']),
  ('KIA-KIKUYU-TOWNSHIP', 'Kiambu', 'Kikuyu', 'Kikuyu Township', array['Kikuyu Town','Ondiri','Gitaru']),
  ('KIA-LIMURU-TOWNSHIP', 'Kiambu', 'Limuru', 'Limuru Central', array['Limuru Town','Ngecha','Tigoni'])
on conflict (county, subcounty, ward) do nothing;

insert into public.purpose_pools (id, name, pool_type, frequency, support_percentage, eligibility_rules)
values
  ('POOL-LICENSE-RENEWAL', 'License Renewal Pool', 'license_renewal', 'monthly', 0, '{"minimumConsistencyDays": 30}'::jsonb),
  ('POOL-PSV-COMPLIANCE', 'PSV Compliance Pool', 'psv_compliance', 'daily', 0, '{"transportOnly": true}'::jsonb),
  ('POOL-INSURANCE', 'Insurance Pool', 'insurance', 'monthly', 0, '{"minimumContributionCount": 3}'::jsonb)
on conflict (id) do nothing;

comment on table public.service_applications is
  'Service requests, county permit cases, overcharge checks, confiscated item cases, and workflow stages.';

comment on table public.service_billing_invoices is
  'Generated service invoices and county/SBC charge calculations.';

comment on table public.member_wallets is
  'Service and transport wallet balances, including withdrawable, reserved, and locked balances.';

comment on table public.member_wallet_transactions is
  'Auditable wallet ledger with officer, timestamp, before balance, and after balance for transport/service funds.';

comment on view public.service_module_dashboard is
  'Summary metrics for the SBC service registration, application, wallet, and county integration module.';

notify pgrst, 'reload schema';

-- =====================================================================
-- End of full.sql
-- =====================================================================
