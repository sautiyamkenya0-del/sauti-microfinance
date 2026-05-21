do $$
begin
  alter table public.loans drop constraint if exists loans_term_days_check;
  alter table public.loans
    add constraint loans_term_days_check
    check (term_days in (7, 14, 30, 60, 90));
exception
  when duplicate_object then null;
end
$$;

insert into public.policy_settings (key, label, value, notes)
values (
  'interest_rates',
  'Interest rates by term',
  jsonb_build_object(
    'standard', jsonb_build_object(
      '7', 10,
      '14', 15,
      '30', 20
    ),
    'premium', jsonb_build_object(
      '14', 15,
      '30', 20,
      '60', 25,
      '90', 25
    )
  ),
  'Separate standard and premium loan interest bands. Manual day entries use the next matching term bucket.'
)
on conflict (key) do update
set
  label = excluded.label,
  value = case
    when jsonb_typeof(public.policy_settings.value->'standard') = 'object'
      and jsonb_typeof(public.policy_settings.value->'premium') = 'object'
      then jsonb_set(
        jsonb_set(
          public.policy_settings.value,
          '{premium,60}',
          coalesce(public.policy_settings.value #> '{premium,60}', '25'::jsonb),
          true
        ),
        '{premium,90}',
        coalesce(public.policy_settings.value #> '{premium,90}', '25'::jsonb),
        true
      )
    else jsonb_build_object(
      'standard', jsonb_build_object(
        '7', coalesce(public.policy_settings.value->'7', '10'::jsonb),
        '14', coalesce(public.policy_settings.value->'14', '15'::jsonb),
        '30', coalesce(public.policy_settings.value->'30', '20'::jsonb)
      ),
      'premium', jsonb_build_object(
        '14', coalesce(public.policy_settings.value->'14', '15'::jsonb),
        '30', coalesce(public.policy_settings.value->'30', '20'::jsonb),
        '60', coalesce(public.policy_settings.value->'60', '25'::jsonb),
        '90', '25'::jsonb
      )
    )
  end,
  notes = excluded.notes,
  updated_at = now();
