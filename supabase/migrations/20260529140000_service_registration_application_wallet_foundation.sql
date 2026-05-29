-- Foundation for the SBC service registration/application guide:
-- service metadata, county schedules, applications, billing, wallets, contributions, and transport groups.

alter table public.service_catalog
  add column if not exists service_category text,
  add column if not exists eligibility_rules jsonb not null default '{}'::jsonb,
  add column if not exists effective_date date not null default current_date,
  add column if not exists expiry_date date,
  add column if not exists registration_fee numeric(14,2) not null default 0,
  add column if not exists processing_fee numeric(14,2) not null default 0,
  add column if not exists service_charge numeric(14,2) not null default 0,
  add column if not exists waiver_amount numeric(14,2) not null default 0,
  add column if not exists penalty_amount numeric(14,2) not null default 0,
  add column if not exists custom_charges jsonb not null default '[]'::jsonb,
  add column if not exists negotiated_discount_amount numeric(14,2) not null default 0,
  add column if not exists normal_deductions jsonb not null default '{}'::jsonb,
  add column if not exists grace_period_days integer not null default 0,
  add column if not exists renewal_rules jsonb not null default '{}'::jsonb;

alter table public.service_catalog
  drop constraint if exists service_catalog_frequency_check;

alter table public.service_catalog
  add constraint service_catalog_frequency_check
  check (
    billing_frequency in (
      'one_time',
      'daily',
      'weekly',
      'monthly',
      'quarterly',
      'semi_annual',
      'annual',
      'yearly',
      'seasonal',
      'custom'
    )
  );

alter table public.service_catalog
  drop constraint if exists service_catalog_scope_check;

alter table public.service_catalog
  add constraint service_catalog_scope_check
  check (scope in ('all_members','sbc_members','service_members','selected_members'));

create table if not exists public.county_charge_schedules (
  id text primary key,
  county text not null default 'Kiambu',
  schedule_version text not null default 'default',
  code text not null,
  description text not null,
  business_type text,
  fire_amount numeric(14,2) not null default 0,
  sw_amount numeric(14,2) not null default 0,
  sbp_amount numeric(14,2) not null default 0,
  app_amount numeric(14,2) not null default 0,
  pho_amount numeric(14,2) not null default 0,
  pho_inspection_amount numeric(14,2) not null default 0,
  other_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) generated always as (
    fire_amount + sw_amount + sbp_amount + app_amount + pho_amount + pho_inspection_amount + other_amount
  ) stored,
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (county, schedule_version, code)
);

alter table public.county_charge_schedules enable row level security;

drop trigger if exists trg_county_charge_schedules_updated_at on public.county_charge_schedules;
create trigger trg_county_charge_schedules_updated_at before update on public.county_charge_schedules
  for each row execute function public.tg_set_updated_at();

create table if not exists public.service_applications (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  service_id text references public.service_catalog(id) on delete set null,
  application_number text not null unique,
  service_type text,
  case_type text not null default 'normal',
  priority text not null default 'normal',
  problem_reason text,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  county text,
  subcounty text,
  ward text,
  town text,
  schedule_id text references public.county_charge_schedules(id) on delete set null,
  invoice_reference text,
  invoice_number text,
  invoice_date date,
  invoice_amount_charged numeric(14,2) not null default 0,
  issue_date date,
  expiry_date date,
  renewal_window_days integer not null default 0,
  grace_period_days integer not null default 0,
  confiscation_reference text,
  inventory_sheet_number text,
  confiscation_date date,
  status text not null default 'submitted',
  payment_status text not null default 'pending',
  workflow_stage text not null default 'application_submitted',
  calculated_charges jsonb not null default '{}'::jsonb,
  created_by text references public.staff(id) on delete set null,
  assigned_to text references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_applications_case_type_check
    check (case_type in ('normal','overcharged_invoice','invoice_with_penalty','confiscated_items')),
  constraint service_applications_priority_check
    check (priority in ('low','normal','high','urgent')),
  constraint service_applications_status_check
    check (status in ('submitted','verification','financial_review','waiver_approval','final_approval','billing','processing','completed','cancelled','under_review')),
  constraint service_applications_payment_status_check
    check (payment_status in ('pending','partially_paid','paid','waived','cancelled','under_review')),
  constraint service_applications_workflow_stage_check
    check (workflow_stage in ('application_submitted','verification','financial_review','waiver_approval','final_approval','billing','service_processing','completed'))
);

alter table public.service_applications enable row level security;

alter table public.members
  add column if not exists linked_previous_number text,
  add column if not exists previous_service_member_number text,
  add column if not exists alternative_phone text,
  add column if not exists email text,
  add column if not exists gender text,
  add column if not exists date_of_birth date,
  add column if not exists county text,
  add column if not exists subcounty text,
  add column if not exists ward text,
  add column if not exists town text,
  add column if not exists physical_address text,
  add column if not exists next_of_kin text,
  add column if not exists next_of_kin_contact text,
  add column if not exists passport_photo_url text,
  add column if not exists business_category_code text,
  add column if not exists business_description text,
  add column if not exists number_of_employees integer,
  add column if not exists kra_pin text,
  add column if not exists business_permit_number text,
  add column if not exists locomotive_details jsonb not null default '{}'::jsonb,
  add column if not exists operation_location jsonb not null default '{}'::jsonb,
  add column if not exists contribution_frequency text not null default 'monthly',
  add column if not exists service_member_upgraded_at timestamptz;

alter table public.members
  drop constraint if exists members_contribution_frequency_check;

alter table public.members
  add constraint members_contribution_frequency_check
  check (contribution_frequency in ('one_time','daily','weekly','monthly','annual','yearly','seasonal','custom'));

drop trigger if exists trg_service_applications_updated_at on public.service_applications;
create trigger trg_service_applications_updated_at before update on public.service_applications
  for each row execute function public.tg_set_updated_at();

create index if not exists idx_service_applications_member
on public.service_applications(member_id, created_at desc);

create index if not exists idx_service_applications_status
on public.service_applications(status, payment_status, created_at desc);

create table if not exists public.service_billing_invoices (
  id text primary key,
  application_id text references public.service_applications(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  service_id text references public.service_catalog(id) on delete set null,
  invoice_number text not null unique,
  county_charges numeric(14,2) not null default 0,
  service_fee numeric(14,2) not null default 0,
  processing_fee numeric(14,2) not null default 0,
  registration_fee numeric(14,2) not null default 0,
  custom_charges numeric(14,2) not null default 0,
  penalty_amount numeric(14,2) not null default 0,
  waiver_amount numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  expected_amount numeric(14,2) not null default 0,
  invoice_amount_charged numeric(14,2) not null default 0,
  overcharge_amount numeric(14,2) not null default 0,
  final_amount numeric(14,2) not null default 0,
  status text not null default 'pending',
  due_date date,
  issued_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_billing_invoices_status_check
    check (status in ('pending','partially_paid','paid','waived','cancelled','under_review'))
);

alter table public.service_billing_invoices enable row level security;

drop trigger if exists trg_service_billing_invoices_updated_at on public.service_billing_invoices;
create trigger trg_service_billing_invoices_updated_at before update on public.service_billing_invoices
  for each row execute function public.tg_set_updated_at();

create index if not exists idx_service_billing_invoices_member
on public.service_billing_invoices(member_id, issued_at desc);

create table if not exists public.member_wallets (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  wallet_type text not null default 'service_wallet',
  balance numeric(14,2) not null default 0,
  withdrawable_balance numeric(14,2) not null default 0,
  reserved_balance numeric(14,2) not null default 0,
  locked_balance numeric(14,2) not null default 0,
  reserve_rules jsonb not null default '{}'::jsonb,
  risk_rating text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (member_id, wallet_type),
  constraint member_wallets_wallet_type_check
    check (wallet_type in ('individual','collective','contribution','welfare','service_wallet')),
  constraint member_wallets_nonnegative_check
    check (balance >= 0 and withdrawable_balance >= 0 and reserved_balance >= 0 and locked_balance >= 0)
);

alter table public.member_wallets enable row level security;

drop trigger if exists trg_member_wallets_updated_at on public.member_wallets;
create trigger trg_member_wallets_updated_at before update on public.member_wallets
  for each row execute function public.tg_set_updated_at();

create table if not exists public.member_contributions (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  contribution_type text not null,
  purpose_pool text,
  amount numeric(14,2) not null default 0,
  frequency text not null default 'monthly',
  status text not null default 'posted',
  posted_by text references public.staff(id) on delete set null,
  posted_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  constraint member_contributions_frequency_check
    check (frequency in ('one_time','daily','weekly','monthly','quarterly','semi_annual','annual','yearly','seasonal','custom')),
  constraint member_contributions_status_check
    check (status in ('expected','posted','missed','waived','reversed'))
);

alter table public.member_contributions enable row level security;

create index if not exists idx_member_contributions_member
on public.member_contributions(member_id, posted_at desc);

create table if not exists public.purpose_pools (
  id text primary key,
  name text not null,
  pool_type text not null,
  frequency text not null default 'monthly',
  support_percentage numeric(6,2) not null default 0,
  eligibility_rules jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purpose_pools_frequency_check
    check (frequency in ('one_time','daily','weekly','monthly','annual','yearly','seasonal','custom')),
  constraint purpose_pools_support_percentage_check
    check (support_percentage >= 0 and support_percentage <= 100)
);

alter table public.purpose_pools enable row level security;

drop trigger if exists trg_purpose_pools_updated_at on public.purpose_pools;
create trigger trg_purpose_pools_updated_at before update on public.purpose_pools
  for each row execute function public.tg_set_updated_at();

create table if not exists public.member_wallet_transactions (
  id text primary key,
  wallet_id text references public.member_wallets(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  group_id text,
  transaction_type text not null,
  amount numeric(14,2) not null default 0,
  balance_before numeric(14,2) not null default 0,
  balance_after numeric(14,2) not null default 0,
  purpose_pool_id text references public.purpose_pools(id) on delete set null,
  officer_id text references public.staff(id) on delete set null,
  reference text,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint member_wallet_transactions_type_check
    check (transaction_type in ('deposit','withdrawal','reserve','release_reserve','lock','unlock','service_payment','welfare_support','adjustment'))
);

alter table public.member_wallet_transactions enable row level security;

create index if not exists idx_member_wallet_transactions_member
on public.member_wallet_transactions(member_id, created_at desc);

create table if not exists public.transport_groups (
  id text primary key,
  group_number text not null unique,
  group_type text not null,
  group_name text not null,
  route_stage text,
  sacco_association text,
  county text,
  subcounty text,
  ward text,
  town_stage text,
  status text not null default 'active',
  officer_assignments jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transport_groups_status_check
    check (status in ('active','inactive','suspended'))
);

alter table public.transport_groups enable row level security;

drop trigger if exists trg_transport_groups_updated_at on public.transport_groups;
create trigger trg_transport_groups_updated_at before update on public.transport_groups
  for each row execute function public.tg_set_updated_at();

do $$
begin
  alter table public.member_wallet_transactions
    add constraint member_wallet_transactions_group_id_fkey
    foreign key (group_id) references public.transport_groups(id) on delete set null;
exception when duplicate_object then null;
end $$;

create table if not exists public.transport_group_members (
  id text primary key,
  group_id text not null references public.transport_groups(id) on delete cascade,
  member_id text not null references public.members(id) on delete cascade,
  role text not null default 'driver',
  vehicle_assigned text,
  route_assigned text,
  stage_assigned text,
  sacco_assigned text,
  status text not null default 'active',
  joined_at date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, member_id),
  constraint transport_group_members_role_check
    check (role in ('driver','conductor','crew','owner','officer')),
  constraint transport_group_members_status_check
    check (status in ('active','inactive','suspended'))
);

alter table public.transport_group_members enable row level security;

drop trigger if exists trg_transport_group_members_updated_at on public.transport_group_members;
create trigger trg_transport_group_members_updated_at before update on public.transport_group_members
  for each row execute function public.tg_set_updated_at();

create table if not exists public.collection_officer_commissions (
  id text primary key,
  officer_id text not null references public.staff(id) on delete cascade,
  group_id text references public.transport_groups(id) on delete set null,
  period_start date not null,
  period_end date not null,
  collection_amount numeric(14,2) not null default 0,
  savings_growth_amount numeric(14,2) not null default 0,
  service_conversion_count integer not null default 0,
  target_amount numeric(14,2) not null default 0,
  commission_amount numeric(14,2) not null default 0,
  status text not null default 'pending',
  calculated_at timestamptz not null default now(),
  paid_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint collection_officer_commissions_status_check
    check (status in ('pending','approved','paid','cancelled'))
);

alter table public.collection_officer_commissions enable row level security;

create table if not exists public.county_admin_locations (
  id text primary key,
  county text not null,
  subcounty text not null,
  ward text not null,
  towns text[] not null default '{}'::text[],
  active boolean not null default true,
  unique (county, subcounty, ward)
);

alter table public.county_admin_locations enable row level security;

create or replace view public.service_module_dashboard as
select
  (select count(*) from public.members where coalesce(member_tags, '{}'::text[]) @> array['service']::text[]) as total_service_members,
  (select count(*) from public.members where coalesce(member_tags, '{}'::text[]) @> array['member']::text[]) as total_sbc_members,
  (select count(*) from public.service_catalog where active = true) as active_services,
  (select count(*) from public.service_applications where status not in ('completed','cancelled')) as pending_applications,
  (select coalesce(sum(final_amount), 0) from public.service_billing_invoices where status in ('paid','partially_paid')) as revenue_collected,
  (select coalesce(sum(balance), 0) from public.member_wallets) as wallet_balances,
  (select coalesce(sum(waiver_amount), 0) from public.service_billing_invoices) as waivers_issued,
  (select coalesce(sum(penalty_amount), 0) from public.service_billing_invoices) as penalties_charged;

create or replace view public.service_member_reports as
select
  m.id,
  coalesce(m.service_member_number, m.id) as service_member_number,
  m.name,
  m.phone,
  m.member_category::text as member_category,
  m.member_tags,
  m.linked_previous_number,
  m.previous_service_member_number,
  coalesce(sum(w.balance), 0) as wallet_balance,
  count(distinct sa.id) as service_application_count,
  count(distinct mc.id) as contribution_count
from public.members m
left join public.member_wallets w on w.member_id = m.id
left join public.service_applications sa on sa.member_id = m.id
left join public.member_contributions mc on mc.member_id = m.id
group by m.id;

insert into public.county_charge_schedules (
  id, county, schedule_version, code, description, business_type,
  fire_amount, sw_amount, sbp_amount, app_amount, pho_amount, pho_inspection_amount
)
values
  ('KIA-SBP-001', 'Kiambu', 'default', 'SBP-001', 'General small business permit', 'permanent', 0, 0, 0, 0, 0, 0),
  ('KIA-TRN-001', 'Kiambu', 'default', 'TRN-001', 'Transport route/stage service', 'locomotive', 0, 0, 0, 0, 0, 0)
on conflict (county, schedule_version, code) do nothing;

insert into public.county_admin_locations (id, county, subcounty, ward, towns)
values
  ('KIA-THIKA-TOWNSHIP', 'Kiambu', 'Thika Town', 'Township', array['Thika CBD','Makongeni','Section 9']),
  ('KIA-RUIRU-BIASHARA', 'Kiambu', 'Ruiru', 'Biashara', array['Ruiru Town','Kwa Kairu','Kimbo']),
  ('KIA-KIAMBU-TOWNSHIP', 'Kiambu', 'Kiambu', 'Township', array['Kiambu Town','Ndumberi','Riabai']),
  ('KIA-KIKUYU-TOWNSHIP', 'Kiambu', 'Kikuyu', 'Kikuyu Township', array['Kikuyu Town','Ondiri','Gitaru']),
  ('KIA-LIMURU-TOWNSHIP', 'Kiambu', 'Limuru', 'Limuru Central', array['Limuru Town','Ngecha','Tigoni'])
on conflict (county, subcounty, ward) do nothing;

insert into public.purpose_pools (id, name, pool_type, frequency, support_percentage, eligibility_rules)
values
  ('POOL-LICENSE-RENEWAL', 'License Renewal Pool', 'license_renewal', 'monthly', 0, '{"minimumConsistencyDays": 30}'::jsonb),
  ('POOL-PSV-COMPLIANCE', 'PSV Compliance Pool', 'psv_compliance', 'daily', 0, '{"transportOnly": true}'::jsonb),
  ('POOL-INSURANCE', 'Insurance Pool', 'insurance', 'monthly', 0, '{"minimumContributionCount": 3}'::jsonb)
on conflict (id) do nothing;

comment on table public.service_applications is
  'Service requests, county permit cases, overcharge checks, confiscated item cases, and workflow stages.';

comment on table public.service_billing_invoices is
  'Generated service invoices and county/SBC charge calculations.';

comment on table public.member_wallets is
  'Service and transport wallet balances, including withdrawable, reserved, and locked balances.';

comment on table public.member_wallet_transactions is
  'Auditable wallet ledger with officer, timestamp, before balance, and after balance for transport/service funds.';

comment on view public.service_module_dashboard is
  'Summary metrics for the SBC service registration, application, wallet, and county integration module.';

notify pgrst, 'reload schema';
