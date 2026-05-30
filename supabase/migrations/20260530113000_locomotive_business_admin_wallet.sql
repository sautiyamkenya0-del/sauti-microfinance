alter type public.staff_role add value if not exists 'locomotive_admin';

alter table public.staff
  add column if not exists member_id text references public.members(id) on delete set null;

alter table public.members
  add column if not exists locomotive_admin_staff_id text references public.staff(id) on delete set null,
  add column if not exists locomotive_admin_member_id text references public.members(id) on delete set null,
  add column if not exists locomotive_business_member boolean not null default false;

create index if not exists idx_members_locomotive_admin_staff
on public.members(locomotive_admin_staff_id, joined_at desc);

create table if not exists public.locomotive_business_wallet_allocations (
  id text primary key,
  admin_staff_id text not null references public.staff(id) on delete restrict,
  admin_member_id text references public.members(id) on delete set null,
  beneficiary_member_id text not null references public.members(id) on delete cascade,
  source_transaction_id text references public.transactions(id) on delete set null,
  service_id text references public.service_catalog(id) on delete set null,
  gross_amount numeric(14,2) not null default 0,
  deduction_amount numeric(14,2) not null default 0,
  net_amount numeric(14,2) not null default 0,
  purpose text not null default 'service',
  note text,
  allocated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint locomotive_business_wallet_amounts_check
    check (gross_amount >= 0 and deduction_amount >= 0 and net_amount >= 0 and gross_amount >= deduction_amount)
);

alter table public.locomotive_business_wallet_allocations enable row level security;

create index if not exists idx_locomotive_business_wallet_allocations_admin
on public.locomotive_business_wallet_allocations(admin_staff_id, allocated_at desc);

create index if not exists idx_locomotive_business_wallet_allocations_member
on public.locomotive_business_wallet_allocations(beneficiary_member_id, allocated_at desc);

insert into public.service_catalog (
  id,
  name,
  service_category,
  description,
  price,
  billing_frequency,
  scope,
  service_charge,
  normal_deductions,
  active
)
values (
  'SVC-LOCOMOTIVE-BUSINESS-WALLET',
  'Locomotive Business Wallet',
  'locomotive_business_wallet',
  'Deductions applied when a locomotive admin redistributes collections to locomotive business members.',
  0,
  'one_time',
  'selected_members',
  0,
  '{}'::jsonb,
  true
)
on conflict (id) do update set
  service_category = excluded.service_category,
  description = excluded.description,
  updated_at = now();

drop view if exists public.service_module_dashboard;

create or replace view public.service_module_dashboard as
select
  (select count(*) from public.members where coalesce(member_tags, '{}'::text[]) @> array['service']::text[]) as total_service_members,
  (select count(*) from public.members where coalesce(member_tags, '{}'::text[]) @> array['member']::text[]) as total_sbc_members,
  (select count(*) from public.members where locomotive_business_member = true) as locomotive_business_members,
  (select count(*) from public.staff where role::text = 'locomotive_admin') as locomotive_admins,
  (select count(*) from public.service_catalog where active = true) as active_services,
  (select count(*) from public.service_applications where status not in ('completed','cancelled')) as pending_applications,
  (select coalesce(sum(final_amount), 0) from public.service_billing_invoices where status in ('paid','partially_paid')) as revenue_collected,
  (select coalesce(sum(balance), 0) from public.member_wallets) as wallet_balances,
  (select coalesce(sum(gross_amount), 0) from public.locomotive_business_wallet_allocations) as locomotive_business_wallet_gross,
  (select coalesce(sum(deduction_amount), 0) from public.locomotive_business_wallet_allocations) as locomotive_business_wallet_deductions,
  (select coalesce(sum(waiver_amount), 0) from public.service_billing_invoices) as waivers_issued,
  (select coalesce(sum(penalty_amount), 0) from public.service_billing_invoices) as penalties_charged;

comment on table public.locomotive_business_wallet_allocations is
  'Allocations made by locomotive admins from their collected deposits to their locomotive business members, with service-controlled deductions.';

notify pgrst, 'reload schema';
