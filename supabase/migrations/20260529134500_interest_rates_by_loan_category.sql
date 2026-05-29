with current_interest as (
  select
    coalesce(value #>> '{standard,7}', value ->> '7', '10')::numeric as standard_7_rate,
    coalesce(value #>> '{standard,14}', value #>> '{standard,7}', value ->> '14', value ->> '7', '10')::numeric as standard_14_rate,
    coalesce(value #>> '{standard,30}', value #>> '{standard,14}', value #>> '{standard,7}', value ->> '30', value ->> '14', value ->> '7', '10')::numeric as standard_30_rate,
    coalesce(value #>> '{premium,14}', value ->> '14', '15')::numeric as premium_14_rate,
    coalesce(value #>> '{premium,30}', value #>> '{premium,14}', value ->> '30', value ->> '14', '15')::numeric as premium_30_rate,
    coalesce(value #>> '{premium,60}', value #>> '{premium,30}', value #>> '{premium,14}', value ->> '60', value ->> '30', value ->> '14', '15')::numeric as premium_60_rate,
    coalesce(value #>> '{premium,90}', value #>> '{premium,60}', value #>> '{premium,30}', value #>> '{premium,14}', value ->> '90', value ->> '60', value ->> '30', value ->> '14', '15')::numeric as premium_90_rate
  from public.policy_settings
  where key = 'interest_rates'
),
resolved_interest as (
  select
    coalesce((select standard_7_rate from current_interest), 10) as standard_7_rate,
    coalesce((select standard_14_rate from current_interest), 10) as standard_14_rate,
    coalesce((select standard_30_rate from current_interest), 10) as standard_30_rate,
    coalesce((select premium_14_rate from current_interest), 15) as premium_14_rate,
    coalesce((select premium_30_rate from current_interest), 15) as premium_30_rate,
    coalesce((select premium_60_rate from current_interest), 15) as premium_60_rate,
    coalesce((select premium_90_rate from current_interest), 15) as premium_90_rate
)
insert into public.policy_settings (key, label, value, notes)
select
  'interest_rates',
  'Interest rates by loan category',
  jsonb_build_object(
    'standard', jsonb_build_object(
      '7', standard_7_rate,
      '14', standard_14_rate,
      '30', standard_30_rate
    ),
    'premium', jsonb_build_object(
      '14', premium_14_rate,
      '30', premium_30_rate,
      '60', premium_60_rate,
      '90', premium_90_rate
    )
  ),
  'Interest percentages are configured by loan category and day bucket. Interest is calculated from net disbursed amount using the rate for the selected repayment days.'
from resolved_interest
on conflict (key) do update
set
  label = excluded.label,
  value = excluded.value,
  notes = excluded.notes,
  updated_at = now();
