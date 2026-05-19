alter type public.fee_scope add value if not exists 'selected_members';

alter table public.fee_policies
  add column if not exists selected_member_ids text[] not null default '{}'::text[];

update public.fee_policies
set selected_member_ids = '{}'::text[]
where selected_member_ids is null;

update public.policy_settings
set value = jsonb_set(
  jsonb_set(coalesce(value, '{}'::jsonb), '{mandatorySavingsThreshold}', to_jsonb(5000), true),
  '{mandatorySharesThreshold}',
  to_jsonb(3000),
  true
)
where key = 'percentages';
