alter table if exists public.followups
  drop constraint if exists followups_loan_id_fkey;

comment on column public.followups.loan_id is
  'References either public.loans.id or public.member_carryover_loans.id so active/defaulted carryover loans can be followed up.';
