alter table public.loans
  add column if not exists frozen_at date,
  add column if not exists frozen_note text,
  add column if not exists penalty_waived_amount numeric(14,2) not null default 0;

comment on column public.loans.frozen_at is
  'When set, follow-up aging and penalty calculations are frozen at this date.';

comment on column public.loans.penalty_waived_amount is
  'Director-approved waiver applied against calculated loan penalties.';
