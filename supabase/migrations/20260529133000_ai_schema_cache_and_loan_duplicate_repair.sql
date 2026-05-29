-- Repair duplicate open loan-category records and refresh PostgREST's schema cache.
-- Business rule: a member may have only one unfinished loan per category.

create or replace function public.sauti_live_loan_settlement_amount(loan_row public.loans)
returns numeric
language sql
stable
as $$
  select greatest(
    0,
    coalesce(
      loan_row.financed_principal_amount,
      loan_row.approved_amount,
      loan_row.principal,
      0
    )
  );
$$;

create or replace function public.sauti_carryover_loan_settlement_amount(loan_row public.member_carryover_loans)
returns numeric
language sql
stable
as $$
  select greatest(
    0,
    coalesce(loan_row.principal, 0)
    + case
        when coalesce(nullif(loan_row.loan_kind, ''), 'financial') in ('fuel', 'stock', 'service') then
          coalesce(nullif(loan_row.fee_breakdown ->> 'processingFeeAmount', '')::numeric, 0)
        else
          coalesce(nullif(loan_row.fee_breakdown ->> 'processingFeeAmount', '')::numeric, 0)
          + coalesce(nullif(loan_row.fee_breakdown ->> 'insuranceFeeAmount', '')::numeric, 0)
          + coalesce(nullif(loan_row.fee_breakdown ->> 'transactionFeeAmount', '')::numeric, 0)
          + (coalesce(loan_row.principal, 0) * coalesce(loan_row.interest_rate_pct, 0) / 100)
            * greatest(1, ceiling(greatest(1, coalesce(loan_row.term_days, 1))::numeric / 30))
          + coalesce(loan_row.daily_savings_amount, 0) * greatest(1, coalesce(loan_row.term_days, 1))
      end
  );
$$;

create or replace function public.sauti_carryover_prior_penalty_amount(loan_row public.member_carryover_loans)
returns numeric
language sql
stable
as $$
  select greatest(
    0,
    coalesce(nullif(loan_row.fee_breakdown ->> 'priorPenaltyAmount', '')::numeric, 0)
    + coalesce(nullif(loan_row.fee_breakdown ->> 'manualPenaltyAmount', '')::numeric, 0)
    + coalesce(nullif(loan_row.fee_breakdown ->> 'carriedForwardPenaltyAmount', '')::numeric, 0)
  );
$$;

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
  latest_source text;
  latest_id text;
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
    select array_agg(l.id order by l.start_date desc nulls last, l.created_at desc nulls last, l.id desc)
      into loan_ids
    from public.loans l
    where l.member_id = group_row.member_id
      and coalesce(nullif(l.loan_kind, ''), 'financial') = group_row.loan_kind
      and l.status in ('pending', 'active', 'defaulted');

    kept_loan_id := loan_ids[1];
    duplicate_ids := loan_ids[2:cardinality(loan_ids)];

    update public.loans duplicate
    set
      status = 'closed',
      paid = greatest(coalesce(duplicate.paid, 0), public.sauti_live_loan_settlement_amount(duplicate)),
      supplier_payload = coalesce(duplicate.supplier_payload, '{}'::jsonb) || jsonb_build_object(
        'closedAsEarlierCycleBeforeLoanId', kept_loan_id,
        'closedFromLifetimeNetAt', now()
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
    select array_agg(cl.id order by cl.start_date desc nulls last, cl.created_at desc nulls last, cl.id desc)
      into loan_ids
    from public.member_carryover_loans cl
    where cl.member_id = group_row.member_id
      and coalesce(nullif(cl.loan_kind, ''), 'financial') = group_row.loan_kind
      and cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false;

    kept_loan_id := loan_ids[1];
    duplicate_ids := loan_ids[2:cardinality(loan_ids)];

    update public.member_carryover_loans duplicate
    set
      status = 'closed',
      finished = true,
      closed_on = coalesce(duplicate.closed_on, duplicate.due_date, current_date),
      paid_to_date = greatest(
        coalesce(duplicate.paid_to_date, 0),
        public.sauti_carryover_loan_settlement_amount(duplicate)
      ),
      penalty_waived_amount = greatest(
        coalesce(duplicate.penalty_waived_amount, 0),
        public.sauti_carryover_prior_penalty_amount(duplicate)
      ),
      fee_breakdown = coalesce(duplicate.fee_breakdown, '{}'::jsonb) || jsonb_build_object(
        'closedAsEarlierCycleBeforeCarryoverId', kept_loan_id,
        'closedFromLifetimeNetAt', now()
      ),
      notes = concat_ws(E'\n', duplicate.notes, 'System closed older same-category cycle from lifetime net before ' || kept_loan_id),
      updated_at = now()
    where duplicate.id = any(duplicate_ids);

    source_table := 'member_carryover_loans';
    member_id := group_row.member_id;
    loan_kind := group_row.loan_kind;
    closed_loan_ids := duplicate_ids;
    closed_count := cardinality(duplicate_ids);
    return next;
  end loop;

  for group_row in
    with open_cycles as (
      select
        'loans'::text as source,
        l.id,
        l.member_id,
        coalesce(nullif(l.loan_kind, ''), 'financial') as loan_kind,
        l.start_date,
        l.created_at
      from public.loans l
      where l.status in ('pending', 'active', 'defaulted')
      union all
      select
        'member_carryover_loans'::text as source,
        cl.id,
        cl.member_id,
        coalesce(nullif(cl.loan_kind, ''), 'financial') as loan_kind,
        cl.start_date,
        cl.created_at
      from public.member_carryover_loans cl
      where cl.status in ('active', 'defaulted')
        and coalesce(cl.finished, false) = false
    ),
    grouped as (
      select
        oc.member_id,
        oc.loan_kind,
        array_agg(oc.source order by oc.start_date desc nulls last, oc.created_at desc nulls last, oc.id desc) as sources,
        array_agg(oc.id order by oc.start_date desc nulls last, oc.created_at desc nulls last, oc.id desc) as ids
      from open_cycles oc
      group by oc.member_id, oc.loan_kind
      having count(*) > 1
    )
    select * from grouped
  loop
    latest_source := group_row.sources[1];
    latest_id := group_row.ids[1];
    kept_loan_id := latest_id;
    duplicate_ids := group_row.ids[2:cardinality(group_row.ids)];

    update public.loans duplicate
    set
      status = 'closed',
      paid = greatest(coalesce(duplicate.paid, 0), public.sauti_live_loan_settlement_amount(duplicate)),
      supplier_payload = coalesce(duplicate.supplier_payload, '{}'::jsonb) || jsonb_build_object(
        'closedAsEarlierCycleBeforeSource', latest_source,
        'closedAsEarlierCycleBeforeId', latest_id,
        'closedFromLifetimeNetAt', now()
      ),
      updated_at = now()
    where duplicate.id = any(duplicate_ids)
      and duplicate.id <> latest_id;

    update public.member_carryover_loans duplicate
    set
      status = 'closed',
      finished = true,
      closed_on = coalesce(duplicate.closed_on, duplicate.due_date, current_date),
      paid_to_date = greatest(
        coalesce(duplicate.paid_to_date, 0),
        public.sauti_carryover_loan_settlement_amount(duplicate)
      ),
      penalty_waived_amount = greatest(
        coalesce(duplicate.penalty_waived_amount, 0),
        public.sauti_carryover_prior_penalty_amount(duplicate)
      ),
      fee_breakdown = coalesce(duplicate.fee_breakdown, '{}'::jsonb) || jsonb_build_object(
        'closedAsEarlierCycleBeforeSource', latest_source,
        'closedAsEarlierCycleBeforeId', latest_id,
        'closedFromLifetimeNetAt', now()
      ),
      notes = concat_ws(E'\n', duplicate.notes, 'System closed older same-category cycle from lifetime net before ' || latest_id),
      updated_at = now()
    where duplicate.id = any(duplicate_ids)
      and duplicate.id <> latest_id;

    source_table := 'loans/member_carryover_loans';
    member_id := group_row.member_id;
    loan_kind := group_row.loan_kind;
    closed_loan_ids := duplicate_ids;
    closed_count := cardinality(duplicate_ids);
    return next;
  end loop;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.loans'::regclass
      and tgname = 'trg_loans_reject_duplicate_open'
      and not tgisinternal
  ) then
    alter table public.loans disable trigger trg_loans_reject_duplicate_open;
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.member_carryover_loans'::regclass
      and tgname = 'trg_member_carryover_loans_reject_duplicate_open'
      and not tgisinternal
  ) then
    alter table public.member_carryover_loans disable trigger trg_member_carryover_loans_reject_duplicate_open;
  end if;
end $$;

select * from public.sauti_repair_duplicate_open_loan_categories();

do $$
begin
  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.loans'::regclass
      and tgname = 'trg_loans_reject_duplicate_open'
      and not tgisinternal
  ) then
    alter table public.loans enable trigger trg_loans_reject_duplicate_open;
  end if;

  if exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.member_carryover_loans'::regclass
      and tgname = 'trg_member_carryover_loans_reject_duplicate_open'
      and not tgisinternal
  ) then
    alter table public.member_carryover_loans enable trigger trg_member_carryover_loans_reject_duplicate_open;
  end if;
end $$;

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
