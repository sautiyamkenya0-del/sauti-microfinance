with current_interest as (
  select
    coalesce(value #>> '{standard,7}', value ->> '7', '10')::numeric as standard_rate,
    coalesce(value #>> '{premium,14}', value ->> '14', '15')::numeric as premium_rate
  from public.policy_settings
  where key = 'interest_rates'
),
resolved_interest as (
  select
    coalesce((select standard_rate from current_interest), 10) as standard_rate,
    coalesce((select premium_rate from current_interest), 15) as premium_rate
)
insert into public.policy_settings (key, label, value, notes)
select
  'interest_rates',
  'Interest rates by loan category',
  jsonb_build_object(
    'standard', jsonb_build_object(
      '7', standard_rate,
      '14', standard_rate,
      '30', standard_rate
    ),
    'premium', jsonb_build_object(
      '14', premium_rate,
      '30', premium_rate,
      '60', premium_rate,
      '90', premium_rate
    )
  ),
  'Fixed standard and premium interest percentages. Interest is calculated from net disbursed amount; repayment days only affect daily repayment.'
from resolved_interest
on conflict (key) do update
set
  label = excluded.label,
  value = excluded.value,
  notes = excluded.notes,
  updated_at = now();
