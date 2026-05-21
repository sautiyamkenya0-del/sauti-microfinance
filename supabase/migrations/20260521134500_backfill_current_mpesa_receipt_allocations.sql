with mpesa_transaction_rows as (
  select
    coalesce(nullif(trim(tx.ref), ''), tx.id) as receipt_ref,
    tx.*
  from public.transactions tx
  where tx.by_staff = 'MPESA'
),
primary_mpesa_transactions as (
  select distinct on (receipt_ref)
    receipt_ref,
    id as primary_transaction_id
  from mpesa_transaction_rows
  order by
    receipt_ref,
    case when type = 'mpesa_unallocated' then 1 else 0 end,
    created_at asc,
    id asc
),
current_mpesa_receipts as (
  select
    tx.receipt_ref,
    max(nullif(trim(tx.account), '')) as account,
    max(nullif(trim(tx.payer_name), '')) as payer_name,
    primary_tx.primary_transaction_id,
    min(tx.created_at) as created_at,
    sum(coalesce(tx.amount, 0)) as transaction_amount
  from mpesa_transaction_rows tx
  join primary_mpesa_transactions primary_tx
    on primary_tx.receipt_ref = tx.receipt_ref
  group by tx.receipt_ref, primary_tx.primary_transaction_id
),
round_off_totals as (
  select
    nullif(trim(ref), '') as receipt_ref,
    sum(coalesce(amount, 0)) as amount
  from public.round_off
  where coalesce(trim(ref), '') <> ''
  group by nullif(trim(ref), '')
)
insert into public.mpesa_events (
  kind,
  account,
  amount,
  mpesa_ref,
  payer_name,
  raw,
  processed,
  transaction_id,
  created_at
)
select
  'confirmation',
  receipt.account,
  receipt.transaction_amount + coalesce(round_off.amount, 0),
  receipt.receipt_ref,
  receipt.payer_name,
  jsonb_build_object(
    'TransactionType', 'Backfilled M-Pesa receipt',
    'TransID', receipt.receipt_ref,
    'BillRefNumber', receipt.account,
    'TransAmount', (receipt.transaction_amount + coalesce(round_off.amount, 0))::text,
    'FirstName', receipt.payer_name,
    'BackfilledFrom', 'public.transactions'
  ),
  true,
  receipt.primary_transaction_id,
  coalesce(receipt.created_at, now())
from current_mpesa_receipts receipt
left join round_off_totals round_off
  on round_off.receipt_ref = receipt.receipt_ref
where not exists (
  select 1
  from public.mpesa_events existing
  where existing.kind = 'confirmation'
    and existing.mpesa_ref = receipt.receipt_ref
);

update public.mpesa_receipt_allocations allocation
set
  event_id = event.id,
  mpesa_ref = event.mpesa_ref
from public.mpesa_events event
where allocation.event_id is null
  and event.kind = 'confirmation'
  and coalesce(trim(allocation.mpesa_ref), '') <> ''
  and event.mpesa_ref = allocation.mpesa_ref;

insert into public.mpesa_receipt_allocations (
  id,
  event_id,
  mpesa_ref,
  member_id,
  loan_id,
  transaction_id,
  allocation_type,
  amount,
  note,
  created_at
)
select
  'MRA' || substr(md5('tx:' || tx.id || ':' || coalesce(e.id::text, receipt.receipt_ref)), 1, 24),
  e.id,
  coalesce(e.mpesa_ref, receipt.receipt_ref),
  tx.member_id,
  tx.loan_id,
  tx.id,
  tx.type::text,
  tx.amount,
  tx.note,
  coalesce(tx.created_at, e.created_at, now())
from public.transactions tx
cross join lateral (
  select coalesce(nullif(trim(tx.ref), ''), tx.id) as receipt_ref
) receipt
left join public.mpesa_events e
  on e.kind = 'confirmation'
 and e.mpesa_ref = receipt.receipt_ref
where tx.by_staff = 'MPESA'
  and not exists (
    select 1
    from public.mpesa_receipt_allocations existing
    where existing.transaction_id = tx.id
      and existing.allocation_type = tx.type::text
  );

insert into public.mpesa_receipt_allocations (
  id,
  event_id,
  mpesa_ref,
  member_id,
  transaction_id,
  allocation_type,
  amount,
  note,
  created_at
)
select
  'MRA' || substr(md5('round_off:' || ro.id || ':' || coalesce(e.id::text, ro.ref, ro.id)), 1, 24),
  e.id,
  coalesce(e.mpesa_ref, ro.ref),
  ro.member_id,
  null,
  'round_off',
  ro.amount,
  'Round-off captured from M-Pesa receipt',
  coalesce(ro.created_at, e.created_at, now())
from public.round_off ro
left join public.mpesa_events e
  on e.kind = 'confirmation'
 and e.mpesa_ref = ro.ref
where ro.ref is not null
  and not exists (
    select 1
    from public.mpesa_receipt_allocations existing
    where existing.event_id is not distinct from e.id
      and existing.allocation_type = 'round_off'
      and existing.amount = ro.amount
      and coalesce(existing.member_id, '') = coalesce(ro.member_id, '')
      and coalesce(existing.note, '') = 'Round-off captured from M-Pesa receipt'
  );

update public.mpesa_receipt_allocations allocation
set
  event_id = event.id,
  mpesa_ref = event.mpesa_ref
from public.mpesa_events event
where allocation.event_id is null
  and event.kind = 'confirmation'
  and coalesce(trim(allocation.mpesa_ref), '') <> ''
  and event.mpesa_ref = allocation.mpesa_ref;
