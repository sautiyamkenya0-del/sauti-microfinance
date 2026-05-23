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
