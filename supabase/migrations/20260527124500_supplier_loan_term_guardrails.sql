alter table public.member_carryover_loans
  drop constraint if exists member_carryover_loans_term_days_check;

alter table public.member_carryover_loans
  add constraint member_carryover_loans_term_days_check
  check (term_days >= 1);

alter table public.loans
  drop constraint if exists loans_term_days_check;

alter table public.loans
  add constraint loans_term_days_check
  check (
    term_days is null
    or (
      coalesce(nullif(loan_kind, ''), 'financial') = 'financial'
      and term_days in (7, 14, 30, 60, 90)
    )
    or (
      coalesce(nullif(loan_kind, ''), 'financial') in ('fuel', 'stock', 'service')
      and term_days >= 1
    )
  );
