update public.policy_settings
set value = jsonb_set(
  jsonb_set(
    coalesce(value, '{}'::jsonb),
    '{penaltyDailyPct}',
    '5'::jsonb,
    true
  ),
  '{de
  '2'::jsonb,
  true
)
where key = 'percentages';
