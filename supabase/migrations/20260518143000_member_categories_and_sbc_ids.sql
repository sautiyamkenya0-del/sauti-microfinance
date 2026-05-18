do $$ begin
  create type public.member_category as enum ('member','investor','both');
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
