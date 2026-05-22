alter table public.member_carryover_loans
  add column if not exists fee_breakdown jsonb not null default '{}'::jsonb;
