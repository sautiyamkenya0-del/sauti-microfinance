-- Repair duplicate open loan-category records and refresh PostgREST's schema cache.
-- Business rule: a member may have only one unfinished loan per category.

create or replace function public.sauti_repair_duplicate_open_loan_categories()
returns table (
  source_table text,
  member_id text,
  loan_kind text,
  kept_loan_id text,
  closed_loan_ids text[],
  closed_count integer
)
language plpgsql
as $$
declare
  group_row record;
  loan_ids text[];
  duplicate_ids text[];
begin
  for group_row in
    select
      l.member_id,
      coalesce(nullif(l.loan_kind, ''), 'financial') as loan_kind
    from public.loans l
    where l.status in ('pending', 'active', 'defaulted')
    group by l.member_id, coalesce(nullif(l.loan_kind, ''), 'financial')
    having count(*) > 1
  loop
    select array_agg(l.id order by l.start_date nulls last, l.created_at nulls last, l.id)
      into loan_ids
    from public.loans l
    where l.member_id = group_row.member_id
      and coalesce(nullif(l.loan_kind, ''), 'financial') = group_row.loan_kind
      and l.status in ('pending', 'active', 'defaulted');

    kept_loan_id := loan_ids[1];
    duplicate_ids := loan_ids[2:cardinality(loan_ids)];

    update public.loans keeper
    set
      principal = coalesce(keeper.principal, 0) + coalesce(extra.principal, 0),
      approved_amount = coalesce(keeper.approved_amount, keeper.principal, 0) + coalesce(extra.approved_amount, 0),
      financed_principal_amount = coalesce(keeper.financed_principal_amount, keeper.approved_amount, keeper.principal, 0) + coalesce(extra.financed_principal_amount, 0),
      paid = coalesce(keeper.paid, 0) + coalesce(extra.paid, 0),
      status = case
        when extra.has_defaulted then 'defaulted'::public.loan_status
        else keeper.status
      end,
      supplier_payload = coalesce(keeper.supplier_payload, '{}'::jsonb) || jsonb_build_object(
        'consolidatedDuplicateLoanIds', to_jsonb(duplicate_ids),
        'consolidatedAt', now()
      ),
      updated_at = now()
    from (
      select
        sum(coalesce(l.principal, 0)) as principal,
        sum(coalesce(l.approved_amount, l.principal, 0)) as approved_amount,
        sum(coalesce(l.financed_principal_amount, l.approved_amount, l.principal, 0)) as financed_principal_amount,
        sum(coalesce(l.paid, 0)) as paid,
        bool_or(l.status = 'defaulted') as has_defaulted
      from public.loans l
      where l.id = any(duplicate_ids)
    ) extra
    where keeper.id = kept_loan_id;

    update public.loans duplicate
    set
      status = 'closed',
      paid = greatest(
        coalesce(duplicate.paid, 0),
        coalesce(duplicate.financed_principal_amount, duplicate.approved_amount, duplicate.principal, 0)
      ),
      supplier_payload = coalesce(duplicate.supplier_payload, '{}'::jsonb) || jsonb_build_object(
        'consolidatedIntoLoanId', kept_loan_id,
        'consolidatedAt', now()
      ),
      updated_at = now()
    where duplicate.id = any(duplicate_ids);

    source_table := 'loans';
    member_id := group_row.member_id;
    loan_kind := group_row.loan_kind;
    closed_loan_ids := duplicate_ids;
    closed_count := cardinality(duplicate_ids);
    return next;
  end loop;

  for group_row in
    select
      cl.member_id,
      coalesce(nullif(cl.loan_kind, ''), 'financial') as loan_kind
    from public.member_carryover_loans cl
    where cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false
    group by cl.member_id, coalesce(nullif(cl.loan_kind, ''), 'financial')
    having count(*) > 1
  loop
    select array_agg(cl.id order by cl.start_date nulls last, cl.created_at nulls last, cl.id)
      into loan_ids
    from public.member_carryover_loans cl
    where cl.member_id = group_row.member_id
      and coalesce(nullif(cl.loan_kind, ''), 'financial') = group_row.loan_kind
      and cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false;

    kept_loan_id := loan_ids[1];
    duplicate_ids := loan_ids[2:cardinality(loan_ids)];

    update public.member_carryover_loans keeper
    set
      principal = coalesce(keeper.principal, 0) + coalesce(extra.principal, 0),
      paid_to_date = coalesce(keeper.paid_to_date, 0) + coalesce(extra.paid_to_date, 0),
      status = case when extra.has_defaulted then 'defaulted' else keeper.status end,
      fee_breakdown = coalesce(keeper.fee_breakdown, '{}'::jsonb) || jsonb_build_object(
        'consolidatedDuplicateCarryoverIds', to_jsonb(duplicate_ids),
        'consolidatedAt', now()
      ),
      notes = concat_ws(
        E'\n',
        keeper.notes,
        'System consolidated duplicate open same-category carryover loans: ' || array_to_string(duplicate_ids, ', ')
      ),
      updated_at = now()
    from (
      select
        sum(coalesce(cl.principal, 0)) as principal,
        sum(coalesce(cl.paid_to_date, 0)) as paid_to_date,
        bool_or(cl.status = 'defaulted') as has_defaulted
      from public.member_carryover_loans cl
      where cl.id = any(duplicate_ids)
    ) extra
    where keeper.id = kept_loan_id;

    update public.member_carryover_loans duplicate
    set
      status = 'closed',
      finished = true,
      closed_on = coalesce(duplicate.closed_on, duplicate.due_date, current_date),
      fee_breakdown = coalesce(duplicate.fee_breakdown, '{}'::jsonb) || jsonb_build_object(
        'consolidatedIntoCarryoverId', kept_loan_id,
        'consolidatedAt', now()
      ),
      notes = concat_ws(E'\n', duplicate.notes, 'System closed after consolidation into ' || kept_loan_id),
      updated_at = now()
    where duplicate.id = any(duplicate_ids);

    source_table := 'member_carryover_loans';
    member_id := group_row.member_id;
    loan_kind := group_row.loan_kind;
    closed_loan_ids := duplicate_ids;
    closed_count := cardinality(duplicate_ids);
    return next;
  end loop;
end;
$$;

alter table public.loans disable trigger trg_loans_reject_duplicate_open;
alter table public.member_carryover_loans disable trigger trg_member_carryover_loans_reject_duplicate_open;

select * from public.sauti_repair_duplicate_open_loan_categories();

alter table public.loans enable trigger trg_loans_reject_duplicate_open;
alter table public.member_carryover_loans enable trigger trg_member_carryover_loans_reject_duplicate_open;

drop index if exists public.loans_one_open_per_member_kind_idx;
create unique index loans_one_open_per_member_kind_idx
on public.loans (member_id, (coalesce(nullif(loan_kind, ''), 'financial')))
where status in ('pending', 'active', 'defaulted');

drop index if exists public.member_carryover_loans_one_open_per_member_kind_idx;
create unique index member_carryover_loans_one_open_per_member_kind_idx
on public.member_carryover_loans (member_id, (coalesce(nullif(loan_kind, ''), 'financial')))
where status in ('active', 'defaulted')
  and coalesce(finished, false) = false;

create or replace function public.tg_reject_duplicate_open_live_loan()
returns trigger
language plpgsql
as $$
declare
  normalized_kind text := coalesce(nullif(new.loan_kind, ''), 'financial');
begin
  if new.status not in ('pending', 'active', 'defaulted') then
    return new;
  end if;

  if exists (
    select 1
    from public.loans l
    where l.member_id = new.member_id
      and coalesce(nullif(l.loan_kind, ''), 'financial') = normalized_kind
      and l.status in ('pending', 'active', 'defaulted')
      and l.id <> new.id
  ) then
    raise exception 'Member % already has an open % loan.', new.member_id, normalized_kind;
  end if;

  if exists (
    select 1
    from public.member_carryover_loans cl
    where cl.member_id = new.member_id
      and coalesce(nullif(cl.loan_kind, ''), 'financial') = normalized_kind
      and cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false
  ) then
    raise exception 'Member % already has an open % carryover loan.', new.member_id, normalized_kind;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_loans_reject_duplicate_open on public.loans;
create trigger trg_loans_reject_duplicate_open
before insert or update of member_id, status, loan_kind
on public.loans
for each row
execute function public.tg_reject_duplicate_open_live_loan();

create or replace function public.tg_reject_duplicate_open_carryover_loan()
returns trigger
language plpgsql
as $$
declare
  normalized_kind text := coalesce(nullif(new.loan_kind, ''), 'financial');
begin
  if coalesce(new.finished, false) = true or new.status not in ('active', 'defaulted') then
    return new;
  end if;

  if exists (
    select 1
    from public.loans l
    where l.member_id = new.member_id
      and coalesce(nullif(l.loan_kind, ''), 'financial') = normalized_kind
      and l.status in ('pending', 'active', 'defaulted')
  ) then
    raise exception 'Member % already has an open % loan.', new.member_id, normalized_kind;
  end if;

  if exists (
    select 1
    from public.member_carryover_loans cl
    where cl.member_id = new.member_id
      and coalesce(nullif(cl.loan_kind, ''), 'financial') = normalized_kind
      and cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false
      and cl.id <> new.id
  ) then
    raise exception 'Member % already has an open % carryover loan.', new.member_id, normalized_kind;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_member_carryover_loans_reject_duplicate_open
on public.member_carryover_loans;

create trigger trg_member_carryover_loans_reject_duplicate_open
before insert or update of member_id, status, loan_kind, finished
on public.member_carryover_loans
for each row
execute function public.tg_reject_duplicate_open_carryover_loan();

notify pgrst, 'reload schema';
