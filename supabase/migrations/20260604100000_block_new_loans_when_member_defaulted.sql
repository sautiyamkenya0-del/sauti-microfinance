create or replace function public.tg_reject_new_loan_when_member_defaulted()
returns trigger
language plpgsql
as $$
begin
  if new.status not in ('pending', 'active', 'defaulted') then
    return new;
  end if;

  if exists (
    select 1
    from public.loans l
    where l.member_id = new.member_id
      and l.status = 'defaulted'
      and l.id <> new.id
  ) then
    raise exception 'Member % has a defaulted loan. Clear the default before opening another loan.', new.member_id;
  end if;

  if exists (
    select 1
    from public.member_carryover_loans cl
    where cl.member_id = new.member_id
      and cl.status = 'defaulted'
      and coalesce(cl.finished, false) = false
  ) then
    raise exception 'Member % has a defaulted carryover loan. Clear the default before opening another loan.', new.member_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_loans_reject_new_when_member_defaulted on public.loans;

create trigger trg_loans_reject_new_when_member_defaulted
before insert or update of member_id, status
on public.loans
for each row
execute function public.tg_reject_new_loan_when_member_defaulted();

create or replace function public.tg_reject_new_carryover_loan_when_member_defaulted()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.finished, false) = true or new.status not in ('active', 'defaulted') then
    return new;
  end if;

  if exists (
    select 1
    from public.loans l
    where l.member_id = new.member_id
      and l.status = 'defaulted'
  ) then
    raise exception 'Member % has a defaulted loan. Clear the default before opening another carryover loan.', new.member_id;
  end if;

  if exists (
    select 1
    from public.member_carryover_loans cl
    where cl.member_id = new.member_id
      and cl.status = 'defaulted'
      and coalesce(cl.finished, false) = false
      and cl.id <> new.id
  ) then
    raise exception 'Member % has a defaulted carryover loan. Clear the default before opening another carryover loan.', new.member_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_member_carryover_loans_reject_new_when_member_defaulted
on public.member_carryover_loans;

create trigger trg_member_carryover_loans_reject_new_when_member_defaulted
before insert or update of member_id, status, finished
on public.member_carryover_loans
for each row
execute function public.tg_reject_new_carryover_loan_when_member_defaulted();
