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
