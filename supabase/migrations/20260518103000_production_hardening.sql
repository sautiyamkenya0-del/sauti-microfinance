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
