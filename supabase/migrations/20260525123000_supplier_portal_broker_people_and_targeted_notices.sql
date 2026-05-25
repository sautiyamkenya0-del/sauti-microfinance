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
