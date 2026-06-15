alter table public.loans
  add column if not exists daily_savings_amount numeric(14,2) not null default 0;

comment on column public.loans.daily_savings_amount is
  'Daily compliance contribution collected alongside live financial loan repayments.';

notify pgrst, 'reload schema';
