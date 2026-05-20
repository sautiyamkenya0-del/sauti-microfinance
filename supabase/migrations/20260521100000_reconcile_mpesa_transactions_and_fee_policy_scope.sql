do $$
begin
  alter type public.tx_type add value if not exists 'mpesa_unallocated';
exception
  when duplicate_object then null;
end $$;

alter table public.fee_policies
  add column if not exists selected_member_ids text[] not null default '{}'::text[];

update public.fee_policies
set selected_member_ids = '{}'::text[]
where selected_member_ids is null;

insert into public.staff (
  id,
  name,
  role,
  can_mark_attendance,
  fingerprint_enrolled
)
values (
  'MPESA',
  'M-Pesa Auto',
  'loan_officer',
  false,
  false
)
on conflict (id) do update
set
  name = excluded.name,
  role = excluded.role,
  can_mark_attendance = false,
  fingerprint_enrolled = false;

drop table if exists pg_temp._duplicate_mpesa_transactions;

create temp table _duplicate_mpesa_transactions on commit drop as
select *
from (
  select
    t.*,
    row_number() over (
      partition by
        t.ref,
        t.type,
        t.amount,
        coalesce(t.account, ''),
        coalesce(t.member_id, ''),
        coalesce(t.loan_id, ''),
        coalesce(t.note, ''),
        coalesce(t.payer_name, '')
      order by t.created_at asc, t.id asc
    ) as duplicate_rank
  from public.transactions t
  where t.by_staff = 'MPESA'
    and coalesce(trim(t.ref), '') <> ''
) ranked
where duplicate_rank > 1;

update public.members m
set savings_balance = greatest(0, coalesce(m.savings_balance, 0) - duplicate_totals.amount)
from (
  select member_id, sum(amount) as amount
  from _duplicate_mpesa_transactions
  where type = 'deposit'
    and member_id is not null
  group by member_id
) duplicate_totals
where m.id = duplicate_totals.member_id;

update public.members m
set shares = greatest(0, coalesce(m.shares, 0) - duplicate_totals.units)
from (
  select member_id, sum(floor(amount / 500)) as units
  from _duplicate_mpesa_transactions
  where type = 'share_purchase'
    and member_id is not null
  group by member_id
) duplicate_totals
where m.id = duplicate_totals.member_id;

update public.investors i
set contributed = greatest(0, coalesce(i.contributed, 0) - duplicate_totals.amount)
from (
  select member_id, sum(amount) as amount
  from _duplicate_mpesa_transactions
  where type = 'investor_contribution'
    and member_id is not null
  group by member_id
) duplicate_totals
where i.member_id = duplicate_totals.member_id;

update public.loans l
set paid = greatest(0, coalesce(l.paid, 0) - duplicate_totals.amount)
from (
  select loan_id, sum(amount) as amount
  from _duplicate_mpesa_transactions
  where type = 'loan_repayment'
    and loan_id is not null
  group by loan_id
) duplicate_totals
where l.id = duplicate_totals.loan_id;

delete from public.transactions t
using _duplicate_mpesa_transactions d
where t.id = d.id;

with event_matches as (
  select distinct on (e.id)
    e.id as event_id,
    t.id as transaction_id
  from public.mpesa_events e
  join public.transactions t
    on t.by_staff = 'MPESA'
    and t.ref is not distinct from e.mpesa_ref
    and upper(coalesce(t.account, '')) = upper(trim(coalesce(e.account, '')))
  where e.kind = 'confirmation'
    and e.transaction_id is null
    and coalesce(trim(e.mpesa_ref), '') <> ''
    and coalesce(trim(e.account), '') <> ''
  order by e.id, t.created_at asc, t.id asc
)
update public.mpesa_events e
set
  processed = true,
  transaction_id = event_matches.transaction_id
from event_matches
where e.id = event_matches.event_id;

do $$
declare
  row record;
  tx_id text;
begin
  for row in
    with confirmation_events as (
      select
        e.id,
        upper(trim(e.account)) as normalized_account,
        nullif(regexp_replace(e.account, '\D', '', 'g'), '') as account_digits,
        e.amount,
        e.mpesa_ref,
        e.payer_name,
        e.created_at
      from public.mpesa_events e
      where e.kind = 'confirmation'
        and e.transaction_id is null
        and coalesce(e.amount, 0) > 0
        and coalesce(trim(e.account), '') <> ''
    )
    select distinct on (e.id)
      e.id,
      e.normalized_account,
      e.amount,
      e.mpesa_ref,
      e.payer_name,
      e.created_at,
      m.id as member_id
    from confirmation_events e
    left join public.members m
      on upper(m.id) = e.normalized_account
      or upper(coalesce(m.old_system_id, '')) = e.normalized_account
      or (
        e.account_digits is not null
        and upper(m.id) in (
          'SBC' || lpad(e.account_digits, 4, '0') || 'K',
          'M' || lpad(e.account_digits, 3, '0')
        )
    )
    order by e.id, m.id nulls last
  loop
    tx_id := null;

    select t.id
      into tx_id
    from public.transactions t
    where t.by_staff = 'MPESA'
      and t.ref is not distinct from row.mpesa_ref
      and upper(coalesce(t.account, '')) = row.normalized_account
    order by t.created_at asc, t.id asc
    limit 1;

    if tx_id is null then
      tx_id := public.next_entity_id('transactions');
      insert into public.transactions (
        id,
        date,
        type,
        amount,
        member_id,
        by_staff,
        note,
        ref,
        account,
        payer_name,
        created_at
      )
      values (
        tx_id,
        coalesce(row.created_at::date, current_date),
        case when row.member_id is null then 'mpesa_unallocated'::public.tx_type else 'deposit'::public.tx_type end,
        row.amount,
        row.member_id,
        'MPESA',
        case
          when row.member_id is null then 'M-Pesa ledger backfill without a matched member'
          else 'M-Pesa ledger backfill for confirmation'
        end,
        row.mpesa_ref,
        row.normalized_account,
        row.payer_name,
        row.created_at
      );
    end if;

    update public.mpesa_events
    set
      processed = true,
      transaction_id = tx_id
    where id = row.id;
  end loop;
end $$;

create unique index if not exists idx_transactions_mpesa_unique_ref_allocation
  on public.transactions (
    ref,
    type,
    amount,
    (coalesce(account, '')),
    (coalesce(member_id, '')),
    (coalesce(loan_id, '')),
    (coalesce(note, '')),
    (coalesce(payer_name, ''))
  )
  where by_staff = 'MPESA'
    and coalesce(trim(ref), '') <> '';

create index if not exists idx_mpesa_events_confirmation_ref
  on public.mpesa_events(kind, mpesa_ref, created_at)
  where kind = 'confirmation'
    and mpesa_ref is not null;
