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
