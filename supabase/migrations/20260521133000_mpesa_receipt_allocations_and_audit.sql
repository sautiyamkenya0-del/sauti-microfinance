create table if not exists public.mpesa_receipt_allocations (
  id text primary key,
  event_id uuid references public.mpesa_events(id) on delete cascade,
  mpesa_ref text,
  member_id text references public.members(id) on delete set null,
  loan_id text references public.loans(id) on delete set null,
  transaction_id text references public.transactions(id) on delete set null,
  allocation_type text not null,
  amount numeric(14,2) not null default 0,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_mpesa_receipt_allocations_event
  on public.mpesa_receipt_allocations(event_id, created_at desc);

create index if not exists idx_mpesa_receipt_allocations_ref
  on public.mpesa_receipt_allocations(mpesa_ref, created_at desc);

create index if not exists idx_mpesa_receipt_allocations_member
  on public.mpesa_receipt_allocations(member_id, created_at desc);

create unique index if not exists idx_mpesa_receipt_allocations_unique_tx
  on public.mpesa_receipt_allocations(event_id, transaction_id, allocation_type)
  where transaction_id is not null;

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
  'MRA' || substr(md5(tx.id || ':' || coalesce(e.id::text, tx.ref, tx.id)), 1, 24),
  e.id,
  coalesce(e.mpesa_ref, tx.ref),
  tx.member_id,
  tx.loan_id,
  tx.id,
  tx.type::text,
  tx.amount,
  tx.note,
  coalesce(tx.created_at, e.created_at, now())
from public.transactions tx
left join public.mpesa_events e
  on e.kind = 'confirmation'
 and e.mpesa_ref = tx.ref
where tx.by_staff = 'MPESA'
  and tx.ref is not null
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
  'MRA' || substr(md5(ro.id || ':' || coalesce(e.id::text, ro.ref, ro.id)), 1, 24),
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
