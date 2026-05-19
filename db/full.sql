-- =====================================================================
-- Sauti Microfinance — FULL DATABASE SCHEMA (canonical)
-- =====================================================================
-- This file is the single source of truth for the database schema.
-- Workflow:
--   1. `db/full.sql` always reflects the COMPLETE current schema.
--   2. Each incremental change ALSO ships as its own file under
--      `db/changes/NNNN_description.sql` (applied via the migration tool).
--   3. After a change is applied, fold it into `db/full.sql` so a fresh
--      environment can be rebuilt from this one file.
--
-- Security model:
--   All tables enable RLS with NO public policies. The app reaches the DB
--   exclusively through TanStack server functions using `supabaseAdmin`
--   (service-role), which bypasses RLS. Direct anon/client access is denied
--   by default. Add explicit policies here only if/when client-side access
--   is required.
-- =====================================================================

-- ---------- Extensions ----------------------------------------------------
create extension if not exists "pgcrypto";

-- ---------- Enums ---------------------------------------------------------
do $$ begin
  create type public.staff_role        as enum ('director','manager','loan_officer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.member_status     as enum ('active','dormant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.loan_status       as enum ('pending','active','closed','defaulted','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tx_type           as enum (
    'deposit','withdrawal','loan_disbursement','loan_repayment',
    'share_purchase','petty_cash','investor_contribution','fee_payment','mpesa_unallocated'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.petty_type        as enum ('payment','topup');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_mode      as enum ('cash','mpesa','bank');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.attendance_status as enum ('present','absent','late');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.field_visit_type  as enum ('business','home','live');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.followup_outcome  as enum ('promised','paid','no-show','dispute','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.penalty_status    as enum ('outstanding','paid');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.penalty_source    as enum ('round_off_pool','direct','mpesa');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.roundoff_source   as enum ('loan_repayment','savings_deposit','share_purchase','manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status   as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fee_scope         as enum ('all','new_only','selected_members','loan_holders','investors');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fee_permanence    as enum ('permanent','semi');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_thread_status as enum ('ai','open','claimed','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_sender_kind as enum ('member','ai','staff');
exception when duplicate_object then null; end $$;

-- ---------- Shared trigger: updated_at -----------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql
set search_path = public
as $$
begin new.updated_at = now(); return new; end;
$$;

-- ---------- staff ---------------------------------------------------------
create table if not exists public.staff (
  id                    text primary key,
  name                  text not null,
  role                  public.staff_role not null,
  email                 text unique,
  phone                 text,
  national_id           text,
  address               text,
  notes                 text,
  photo                 text,
  temp_password         text,
  can_mark_attendance   boolean not null default false,
  fingerprint_enrolled  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.staff enable row level security;
drop trigger if exists trg_staff_updated_at on public.staff;
create trigger trg_staff_updated_at before update on public.staff
  for each row execute function public.tg_set_updated_at();

-- ---------- members -------------------------------------------------------
create table if not exists public.members (
  id                    text primary key,
  name                  text not null,
  phone                 text not null,
  joined_at             date not null default current_date,
  status                public.member_status not null default 'active',
  shares                integer not null default 0,
  savings_balance       numeric(14,2) not null default 0,
  -- mandatory fees
  fee_membership        boolean not null default false,
  fee_card              boolean not null default false,
  fee_has_shop          boolean not null default false,
  fee_sticker           boolean not null default false,
  fee_first_upfront_paid boolean not null default false,
  -- investor link
  is_investor           boolean not null default false,
  investor_id           text,
  -- extended profile
  first_name            text,
  last_name             text,
  dob                   date,
  gender                text check (gender in ('Male','Female')),
  email                 text,
  address               text,
  city                  text,
  county                text,
  village               text,
  savings_only          boolean not null default false,
  old_system_id         text,
  business_name         text,
  business_type         text,
  business_address      text,
  field_officer_id      text references public.staff(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter table public.members enable row level security;
create index if not exists idx_members_phone on public.members(phone);
create index if not exists idx_members_field_officer on public.members(field_officer_id);
drop trigger if exists trg_members_updated_at on public.members;
create trigger trg_members_updated_at before update on public.members
  for each row execute function public.tg_set_updated_at();

-- ---------- investors -----------------------------------------------------
create table if not exists public.investors (
  id            text primary key,
  name          text not null,
  contributed   numeric(14,2) not null default 0,
  share_pct     numeric(6,3) not null default 0,
  joined_at     date not null default current_date,
  phone         text,
  notes         text,
  member_id     text references public.members(id) on delete set null,
  created_at    timestamptz not null default now()
);
alter table public.investors enable row level security;
-- backfill FK from members.investor_id
do $$ begin
  alter table public.members
    add constraint members_investor_fk
    foreign key (investor_id) references public.investors(id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------- loans ---------------------------------------------------------
create table if not exists public.loans (
  id              text primary key,
  member_id       text not null references public.members(id) on delete cascade,
  principal       numeric(14,2) not null,
  approved_amount numeric(14,2),
  rate            numeric(6,3) not null default 0,
  term_months     integer not null default 0,
  term_days       integer check (term_days in (7,14,30)),
  start_date      date not null default current_date,
  status          public.loan_status not null default 'pending',
  officer_id      text references public.staff(id) on delete set null,
  paid            numeric(14,2) not null default 0,
  purpose         text,
  reviewed_by     text references public.staff(id) on delete set null,
  review_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.loans enable row level security;
create index if not exists idx_loans_member on public.loans(member_id);
create index if not exists idx_loans_status on public.loans(status);
drop trigger if exists trg_loans_updated_at on public.loans;
create trigger trg_loans_updated_at before update on public.loans
  for each row execute function public.tg_set_updated_at();

-- ---------- transactions (paybill ledger) --------------------------------
create table if not exists public.transactions (
  id          text primary key,
  date        date not null default current_date,
  type        public.tx_type not null,
  account     text,
  payer_name  text,
  amount      numeric(14,2) not null,
  member_id   text references public.members(id) on delete set null,
  loan_id     text references public.loans(id) on delete set null,
  ref         text,
  by_staff    text references public.staff(id) on delete set null,
  note        text,
  created_at  timestamptz not null default now()
);
alter table public.transactions enable row level security;
create index if not exists idx_tx_member on public.transactions(member_id);
create index if not exists idx_tx_loan on public.transactions(loan_id);
create index if not exists idx_tx_date on public.transactions(date);
create index if not exists idx_tx_ref on public.transactions(ref);

-- ---------- petty_cash ----------------------------------------------------
create table if not exists public.petty_cash (
  id              text primary key,
  date            date not null default current_date,
  description     text not null,
  amount          numeric(14,2) not null,
  category        text,
  by_staff        text references public.staff(id) on delete set null,
  time            text,
  type            public.petty_type,
  payee           text,
  contact         text,
  mode            public.payment_mode,
  reference       text,
  txn_cost        numeric(14,2),
  opening_balance numeric(14,2),
  created_at      timestamptz not null default now()
);
alter table public.petty_cash enable row level security;

-- ---------- attendance ----------------------------------------------------
create table if not exists public.attendance (
  id          text primary key,
  staff_id    text not null references public.staff(id) on delete cascade,
  date        date not null,
  status      public.attendance_status not null,
  check_in    text,
  check_out   text,
  created_at  timestamptz not null default now(),
  unique (staff_id, date)
);
alter table public.attendance enable row level security;

-- ---------- staff_messages ------------------------------------------------
create table if not exists public.staff_messages (
  id           text primary key,
  sender_id    text not null references public.staff(id) on delete cascade,
  receiver_id  text not null references public.staff(id) on delete cascade,
  sender_name  text not null,
  content      text,
  attachment   jsonb,
  created_at   timestamptz not null default now()
);
alter table public.staff_messages enable row level security;
create index if not exists idx_staff_messages_sender on public.staff_messages(sender_id, created_at desc);
create index if not exists idx_staff_messages_receiver on public.staff_messages(receiver_id, created_at desc);

-- ---------- staff_memos ---------------------------------------------------
create table if not exists public.staff_memos (
  id           text primary key,
  memo_date    date not null default current_date,
  title        text not null,
  body         text not null,
  by_staff_id  text references public.staff(id) on delete set null,
  by_name      text not null,
  created_at   timestamptz not null default now()
);
alter table public.staff_memos enable row level security;
create index if not exists idx_staff_memos_date on public.staff_memos(memo_date desc, created_at desc);

-- ---------- approval_requests --------------------------------------------
create table if not exists public.approval_requests (
  id                 text primary key,
  kind               text not null,
  title              text not null,
  detail             text not null,
  requested_by       text not null,
  requested_by_name  text,
  payload            jsonb,
  status             public.approval_status not null default 'pending',
  created_at         timestamptz not null default now(),
  reviewed_by        text,
  review_note        text,
  reviewed_at        timestamptz
);
alter table public.approval_requests enable row level security;
create index if not exists idx_approval_requests_status on public.approval_requests(status, created_at desc);

-- ---------- fee_policies --------------------------------------------------
create table if not exists public.fee_policies (
  key            text primary key,
  label          text not null,
  amount         numeric(14,2) not null default 0,
  permanence     public.fee_permanence not null default 'permanent',
  duration_days  integer,
  effective_from date not null default current_date,
  scope          public.fee_scope not null default 'all',
  selected_member_ids text[] not null default '{}'::text[],
  custom         boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
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

-- ---------- support_threads ----------------------------------------------
create table if not exists public.support_threads (
  id                text primary key,
  member_id         text not null references public.members(id) on delete cascade,
  member_name       text not null,
  assigned_staff_id text references public.staff(id) on delete set null,
  status            public.support_thread_status not null default 'open',
  subject           text not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.support_threads enable row level security;
create index if not exists idx_support_threads_status on public.support_threads(status, updated_at desc);
create index if not exists idx_support_threads_assigned on public.support_threads(assigned_staff_id, updated_at desc);
drop trigger if exists trg_support_threads_updated_at on public.support_threads;
create trigger trg_support_threads_updated_at before update on public.support_threads
  for each row execute function public.tg_set_updated_at();

-- ---------- support_messages ---------------------------------------------
create table if not exists public.support_messages (
  id           text primary key,
  thread_id    text not null references public.support_threads(id) on delete cascade,
  sender_kind  public.support_sender_kind not null,
  sender_name  text not null,
  sender_id    text,
  text         text not null,
  created_at   timestamptz not null default now()
);
alter table public.support_messages enable row level security;
create index if not exists idx_support_messages_thread on public.support_messages(thread_id, created_at asc);

-- ---------- appraisals ----------------------------------------------------
create table if not exists public.appraisals (
  id                    text primary key,
  member_id             text not null references public.members(id) on delete cascade,
  loan_id               text references public.loans(id) on delete set null,
  date                  date not null default current_date,
  officer_id            text references public.staff(id) on delete set null,
  good_day              numeric(14,2) not null default 0,
  average_day           numeric(14,2) not null default 0,
  bad_day               numeric(14,2) not null default 0,
  operating_expenses    numeric(14,2) not null default 0,
  non_earning_days      integer not null default 0,
  existing_debt         numeric(14,2) not null default 0,
  monthly_debt_repayment numeric(14,2) not null default 0,
  crb_status            text check (crb_status in ('Positive','Negative','Unknown','No Record')),
  reschedules_last_12   integer not null default 0,
  dti                   numeric(8,3),
  dicr                  numeric(8,3),
  bdsr                  numeric(8,3),
  lsr                   numeric(8,3),
  savings_buffer        numeric(14,2),
  score_dicr            numeric(6,2),
  score_bdsr            numeric(6,2),
  score_savings         numeric(6,2),
  score_crb             numeric(6,2),
  score_burden          numeric(6,2),
  score_docs            numeric(6,2),
  score_coop            numeric(6,2),
  total_score           numeric(6,2),
  decision              text check (decision in ('Approve','Approve with Adjustments','Refer / Downsize','Reject')),
  risk_level            text check (risk_level in ('LOW','MODERATE','HIGH','VERY HIGH')),
  approved_amount       numeric(14,2),
  approved_term         text,
  special_conditions    text,
  notes                 text,
  created_at            timestamptz not null default now()
);
alter table public.appraisals enable row level security;

-- ---------- field_visits --------------------------------------------------
create table if not exists public.field_visits (
  id              text primary key,
  member_id       text not null references public.members(id) on delete cascade,
  date            date not null default current_date,
  type            public.field_visit_type not null,
  lat             numeric(10,6),
  lng             numeric(10,6),
  location_notes  text,
  photos          text[],
  by_staff        text references public.staff(id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.field_visits enable row level security;

-- ---------- followups -----------------------------------------------------
create table if not exists public.followups (
  id          text primary key,
  loan_id     text not null references public.loans(id) on delete cascade,
  member_id   text not null references public.members(id) on delete cascade,
  date        date not null default current_date,
  note        text not null,
  outcome     public.followup_outcome not null,
  by_staff    text references public.staff(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.followups enable row level security;

-- ---------- penalties -----------------------------------------------------
create table if not exists public.penalties (
  id          text primary key,
  member_id   text not null references public.members(id) on delete cascade,
  loan_id     text references public.loans(id) on delete set null,
  date        date not null default current_date,
  amount      numeric(14,2) not null,
  reason      text not null,
  status      public.penalty_status not null default 'outstanding',
  paid_from   public.penalty_source,
  created_at  timestamptz not null default now()
);
alter table public.penalties enable row level security;

-- ---------- round_off -----------------------------------------------------
create table if not exists public.round_off (
  id          text primary key,
  member_id   text not null references public.members(id) on delete cascade,
  date        date not null default current_date,
  amount      numeric(14,2) not null,
  source      public.roundoff_source not null,
  ref         text,
  created_at  timestamptz not null default now()
);
alter table public.round_off enable row level security;

-- ---------- runtime_secrets -----------------------------------------------
create table if not exists public.runtime_secrets (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);
alter table public.runtime_secrets enable row level security;

-- ---------- mpesa_events (raw STK / C2B callbacks for audit) --------------
create table if not exists public.mpesa_events (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,                 -- 'stkpush','validation','confirmation','diagnose'
  account         text,
  phone           text,
  amount          numeric(14,2),
  mpesa_ref       text,
  payer_name      text,
  raw             jsonb not null,
  processed       boolean not null default false,
  transaction_id  text references public.transactions(id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.mpesa_events enable row level security;
create index if not exists idx_mpesa_events_account on public.mpesa_events(account);
create index if not exists idx_mpesa_events_ref on public.mpesa_events(mpesa_ref);

-- ---------- audit_log ------------------------------------------------------
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  ts          timestamptz not null default now(),
  actor_id    text,
  actor_name  text,
  actor_role  text,
  action      text not null,
  target_type text,
  target_id   text,
  summary     text not null,
  details     jsonb,
  ip          text,
  user_agent  text
);
create index if not exists audit_log_ts_idx on public.audit_log (ts desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id);
create index if not exists audit_log_action_idx on public.audit_log (action);
create index if not exists audit_log_target_idx on public.audit_log (target_type, target_id);
alter table public.audit_log enable row level security;

-- ---------- idempotency_keys ----------------------------------------------
create table if not exists public.idempotency_keys (
  key         text primary key,
  scope       text not null,
  result      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idempotency_keys_created_idx on public.idempotency_keys (created_at);
alter table public.idempotency_keys enable row level security;

-- ---------- Seed: bootstrap director admin --------------------------------
insert into public.staff (id, name, role, email, temp_password, can_mark_attendance)
values ('S1','System Admin','director','admin@sauti.co.ke','Sauti1234', true)
on conflict (id) do nothing;

-- =====================================================================
-- End of full.sql
-- =====================================================================
