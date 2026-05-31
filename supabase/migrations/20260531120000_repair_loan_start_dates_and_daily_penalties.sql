-- Repair active loan collection dates that were left on the application date.
-- Collection must never begin before the loan has been appraised/approved or disbursed.

with latest_appraisals as (
  select
    loan_id,
    max(date) as appraisal_date
  from public.appraisals
  where loan_id is not null
  group by loan_id
),
candidate_dates as (
  select
    l.id,
    greatest(
      l.start_date,
      case
        when la.appraisal_date is not null then la.appraisal_date + 1
        else l.start_date
      end,
      case
        when l.disbursement_completed_at is not null
          then l.disbursement_completed_at::date + 1
        else l.start_date
      end
    ) as corrected_start_date
  from public.loans l
  left join latest_appraisals la on la.loan_id = l.id
  where l.status in ('active', 'defaulted')
)
update public.loans l
set start_date = c.corrected_start_date
from candidate_dates c
where l.id = c.id
  and l.start_date <> c.corrected_start_date;

notify pgrst, 'reload schema';
