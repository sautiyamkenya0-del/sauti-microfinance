alter type public.member_docket add value if not exists 'service_wallet';

alter table public.staff_memos
  add column if not exists document_kind text not null default 'memo',
  add column if not exists letter_meta jsonb not null default '{}'::jsonb;

create index if not exists idx_staff_memos_document_kind
on public.staff_memos(document_kind, memo_date desc);

alter table public.members
  add column if not exists service_member_number text;

create unique index if not exists idx_members_service_member_number
on public.members(service_member_number)
where service_member_number is not null;

create table if not exists public.service_catalog (
  id text primary key,
  name text not null,
  description text,
  price numeric(14,2) not null default 0,
  billing_frequency text not null default 'monthly',
  scope text not null default 'all_members',
  selected_member_ids text[] not null default '{}'::text[],
  deduction_mode text not null default 'normal',
  fee_overrides jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by text references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_catalog_frequency_check
    check (billing_frequency in ('one_time','daily','weekly','monthly','yearly')),
  constraint service_catalog_scope_check
    check (scope in ('all_members','service_members','selected_members'))
);

alter table public.service_catalog enable row level security;

alter table public.service_catalog
  add column if not exists deduction_mode text not null default 'normal',
  add column if not exists fee_overrides jsonb not null default '{}'::jsonb;

do $$
begin
  alter table public.service_catalog
    add constraint service_catalog_deduction_mode_check
    check (deduction_mode in ('normal','override_all','amended_override'));
exception when duplicate_object then null;
end $$;

drop trigger if exists trg_service_catalog_updated_at on public.service_catalog;
create trigger trg_service_catalog_updated_at before update on public.service_catalog
  for each row execute function public.tg_set_updated_at();

create table if not exists public.member_service_subscriptions (
  member_id text not null references public.members(id) on delete cascade,
  service_id text not null references public.service_catalog(id) on delete cascade,
  status text not null default 'active',
  assigned_by text references public.staff(id) on delete set null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (member_id, service_id),
  constraint member_service_subscriptions_status_check
    check (status in ('active','paused','cancelled'))
);

alter table public.member_service_subscriptions enable row level security;

drop trigger if exists trg_member_service_subscriptions_updated_at
on public.member_service_subscriptions;
create trigger trg_member_service_subscriptions_updated_at
before update on public.member_service_subscriptions
for each row execute function public.tg_set_updated_at();

create index if not exists idx_member_service_subscriptions_service
on public.member_service_subscriptions(service_id, status);

create index if not exists idx_member_service_subscriptions_member
on public.member_service_subscriptions(member_id, status);

insert into public.fee_policies (
  key, label, amount, permanence, effective_from, scope, custom, notes
)
values (
  'sticker',
  'Member Buffer',
  3000,
  'permanent',
  current_date,
  'all',
  false,
  'Replaces the old shop sticker fee while keeping the sticker key for existing ledgers.'
)
on conflict (key) do update set
  label = excluded.label,
  amount = excluded.amount,
  permanence = excluded.permanence,
  effective_from = least(public.fee_policies.effective_from, excluded.effective_from),
  scope = excluded.scope,
  custom = excluded.custom,
  notes = excluded.notes,
  updated_at = now();

comment on column public.staff_memos.document_kind is
  'memo for normal notices, letter for member-downloadable letterhead documents.';

comment on column public.staff_memos.letter_meta is
  'Letterhead options, selected member facts, included fields, and delivery/download metadata.';

comment on column public.service_catalog.deduction_mode is
  'normal applies normal service deduction, override_all replaces other deductions, amended_override stores custom fee overrides.';

update public.policy_settings
set value = coalesce(value, '{}'::jsonb)
  || jsonb_build_object(
    'fuelBufferAmount', coalesce(value->'fuelBufferAmount', '3000'::jsonb),
    'fuelChargeAmount', coalesce(value->'fuelChargeAmount', '100'::jsonb),
    'stockChargeAmount', coalesce(value->'stockChargeAmount', '100'::jsonb)
  ),
  notes = coalesce(notes, '') || ' Configurable fuel buffer, fuel charge, and stock charge added.',
  updated_at = now()
where key = 'percentages';
