alter table public.loans
  add column if not exists daily_savings_amount numeric(14,2) not null default 0;

comment on column public.loans.daily_savings_amount is
  'Daily compliance contribution collected alongside live financial loan repayments.';

alter table public.staff_payroll_payments
  add column if not exists payout_mode text not null default 'gross_payable';

do $$
begin
  alter table public.staff_payroll_payments
    add constraint staff_payroll_payments_payout_mode_check
    check (payout_mode in ('gross_payable', 'base_salary'));
exception
  when duplicate_object then null;
end
$$;

insert into public.fee_policies
  (key, label, amount, permanence, duration_days, effective_from, scope, custom, notes)
values
  (
    'monthly_member_subscription',
    'Monthly Member Subscription',
    100,
    'permanent',
    null,
    current_date,
    'loan_holders',
    true,
    'Recurring monthly fee for members with loan savings / active loan accounts.'
  ),
  (
    'annual_member_subscription',
    'Annual Member Subscription',
    100,
    'permanent',
    null,
    current_date,
    'loan_holders',
    true,
    'Recurring annual fee for members with loan savings / active loan accounts.'
  )
on conflict (key) do update set
  label = excluded.label,
  amount = excluded.amount,
  permanence = excluded.permanence,
  scope = excluded.scope,
  custom = excluded.custom,
  notes = excluded.notes,
  updated_at = now();
