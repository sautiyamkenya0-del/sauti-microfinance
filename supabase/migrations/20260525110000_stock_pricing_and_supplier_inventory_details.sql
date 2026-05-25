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
