create table if not exists public.policy_settings (
  key text primary key,
  label text not null,
  value jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.policy_settings enable row level security;
drop trigger if exists trg_policy_settings_updated_at on public.policy_settings;
create trigger trg_policy_settings_updated_at before update on public.policy_settings
  for each row execute function public.tg_set_updated_at();

insert into public.policy_settings (key, label, value, notes)
values
  (
    'percentages',
    'Percentages and fixed values',
    jsonb_build_object(
      'processingPct', 2,
      'insurancePct', 1.5,
      'transactionCostPct', 0,
      'penaltyDailyPct', 5,
      'defaultPenaltyPct', 2,
      'firstUpfrontAmount', 500,
      'mandatorySavingsThreshold', 5000,
      'mandatorySharesThreshold', 3000,
      'roundOffStep', 1
    ),
    'Shared percentage controls for deductions, penalties, and fixed collection prompts.'
  ),
  (
    'interest_rates',
    'Interest rates by term',
    jsonb_build_object(
      '7', 10,
      '14', 15,
      '30', 20,
      '60', 25,
      '90', 30
    ),
    'Fixed interest rates used when pricing new loans by term bucket.'
  ),
  (
    'waterfall_rules',
    'Payment waterfall rules',
    jsonb_build_array(
      jsonb_build_object(
        'scenario', 'member_with_loan',
        'steps', jsonb_build_array(
          'membership_fee',
          'card_fee',
          'sticker_fee',
          'penalties'
        )
      ),
      jsonb_build_object(
        'scenario', 'member_without_loan',
        'steps', jsonb_build_array(
          'membership_fee',
          'card_fee',
          'sticker_fee',
          'penalties'
        )
      ),
      jsonb_build_object(
        'scenario', 'investor_only',
        'steps', jsonb_build_array('investment')
      )
    ),
    'Scenario-based default M-Pesa waterfall rules.'
  )
on conflict (key) do nothing;

create table if not exists public.performance_targets (
  id text primary key,
  metric text not null,
  period text not null,
  expected_value numeric(14,2) not null default 0,
  start_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint performance_targets_period_check
    check (period in ('daily', 'weekly', 'monthly', 'annual')),
  constraint performance_targets_metric_check
    check (
      metric in (
        'collections_total',
        'loan_repayments',
        'loan_disbursements',
        'new_loans_count',
        'registrations',
        'cards_paid',
        'stickers_paid',
        'stickers_issued'
      )
    )
);

alter table public.performance_targets enable row level security;
drop trigger if exists trg_performance_targets_updated_at on public.performance_targets;
create trigger trg_performance_targets_updated_at before update on public.performance_targets
  for each row execute function public.tg_set_updated_at();

create index if not exists idx_performance_targets_period_start
  on public.performance_targets(period, start_on desc);
