create sequence if not exists public.suppliers_id_seq;

alter table public.suppliers
  add column if not exists supplier_number text;

with existing_max as (
  select coalesce(
    max(nullif(regexp_replace(supplier_number, '\D', '', 'g'), '')::bigint),
    0
  ) as base
  from public.suppliers
  where supplier_number ~ '^SUP[0-9]+$'
),
numbered as (
  select
    s.id,
    existing_max.base + row_number() over (order by s.created_at nulls last, s.id) as next_value
  from public.suppliers s
  cross join existing_max
  where coalesce(trim(s.supplier_number), '') = ''
)
update public.suppliers s
set supplier_number =
  'SUP' ||
  case
    when numbered.next_value < 10000 then lpad(numbered.next_value::text, 4, '0')
    else numbered.next_value::text
  end
from numbered
where s.id = numbered.id;

create unique index if not exists idx_suppliers_supplier_number
on public.suppliers(supplier_number)
where supplier_number is not null;

alter table public.suppliers
  alter column supplier_number set not null;

do $$
declare
  max_supplier_number bigint;
begin
  select coalesce(max(nullif(regexp_replace(supplier_number, '\D', '', 'g'), '')::bigint), 0)
    into max_supplier_number
  from public.suppliers
  where supplier_number ~ '^SUP[0-9]+$';

  if max_supplier_number < 1 then
    perform setval('public.suppliers_id_seq', 1, false);
  else
    perform setval('public.suppliers_id_seq', max_supplier_number, true);
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

    when 'suppliers' then
      next_value := nextval('public.suppliers_id_seq');
      return 'SUP' ||
        case
          when next_value < 10000 then lpad(next_value::text, 4, '0')
          else next_value::text
        end;

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

alter table public.suppliers
  alter column supplier_number set default public.next_entity_id('suppliers');
