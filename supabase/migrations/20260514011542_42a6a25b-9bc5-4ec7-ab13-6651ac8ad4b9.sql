-- Initial schema for Sauti Microfinance (matches db/full.sql)
create extension if not exists "pgcrypto";

do $$ begin create type public.staff_role as enum ('director','manager','loan_officer'); exception when duplicate_object then null; end $$;
do $$ begin create type public.member_status as enum ('active','dormant'); exception when duplicate_object then null; end $$;
do $$ begin create type public.loan_status as enum ('pending','active','closed','defaulted','rejected'); exception when duplicate_object then null; end $$;
do $$ begin create type public.tx_type as enum ('deposit','withdrawal','loan_disbursement','loan_repayment','share_purchase','petty_cash','investor_contribution','fee_payment'); exception when duplicate_object then null; end $$;
do $$ begin create type public.petty_type as enum ('payment','topup'); exception when duplicate_object then null; end $$;
do $$ begin create type public.payment_mode as enum ('cash','mpesa','bank'); exception when duplicate_object then null; end $$;
do $$ begin create type public.attendance_status as enum ('present','absent','late'); exception when duplicate_object then null; end $$;
do $$ begin create type public.field_visit_type as enum ('business','home','live'); exception when duplicate_object then null; end $$;
do $$ begin create type public.followup_outcome as enum ('promised','paid','no-show','dispute','other'); exception when duplicate_object then null; end $$;
do $$ begin create type public.penalty_status as enum ('outstanding','paid'); exception when duplicate_object then null; end $$;
do $$ begin create type public.penalty_source as enum ('round_off_pool','direct','mpesa'); exception when duplicate_object then null; end $$;
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
  business_name text, business_type text, business_address text,
  field_officer_id text references public.staff(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.members enable row level security;
create index if not exists idx_members_phone on public.members(phone);
create index if not exists idx_members_field_officer on public.members(field_officer_id);
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