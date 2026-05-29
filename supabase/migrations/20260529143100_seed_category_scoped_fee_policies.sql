update public.fee_policies
set label = 'Sticker Fee',
    scope = 'financial_members'
where key = 'sticker';

insert into public.fee_policies (key, label, amount, permanence, effective_from, scope, custom, notes)
values (
  'fuel_buffer',
  'Fuel Buffer',
  1000,
  'permanent',
  current_date,
  'locomotive_members',
  false,
  'Applies only to locomotive members.'
)
on conflict (key) do update
set label = excluded.label,
    scope = excluded.scope,
    notes = coalesce(public.fee_policies.notes, excluded.notes),
    updated_at = now();
