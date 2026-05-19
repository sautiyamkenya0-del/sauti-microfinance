do $$ begin
  create type public.approval_status as enum ('pending','approved','rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fee_scope as enum ('all','new_only','selected_members','loan_holders','investors');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fee_permanence as enum ('permanent','semi');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_thread_status as enum ('ai','open','claimed','closed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.support_sender_kind as enum ('member','ai','staff');
exception when duplicate_object then null; end $$;

create table if not exists public.staff_messages (
  id text primary key,
  sender_id text not null references public.staff(id) on delete cascade,
  receiver_id text not null references public.staff(id) on delete cascade,
  sender_name text not null,
  content text,
  attachment jsonb,
  created_at timestamptz not null default now()
);
alter table public.staff_messages enable row level security;
create index if not exists idx_staff_messages_sender on public.staff_messages(sender_id, created_at desc);
create index if not exists idx_staff_messages_receiver on public.staff_messages(receiver_id, created_at desc);

create table if not exists public.staff_memos (
  id text primary key,
  memo_date date not null default current_date,
  title text not null,
  body text not null,
  by_staff_id text references public.staff(id) on delete set null,
  by_name text not null,
  created_at timestamptz not null default now()
);
alter table public.staff_memos enable row level security;
create index if not exists idx_staff_memos_date on public.staff_memos(memo_date desc, created_at desc);

create table if not exists public.approval_requests (
  id text primary key,
  kind text not null,
  title text not null,
  detail text not null,
  requested_by text not null,
  requested_by_name text,
  payload jsonb,
  status public.approval_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_by text,
  review_note text,
  reviewed_at timestamptz
);
alter table public.approval_requests enable row level security;
create index if not exists idx_approval_requests_status on public.approval_requests(status, created_at desc);

create table if not exists public.fee_policies (
  key text primary key,
  label text not null,
  amount numeric(14,2) not null default 0,
  permanence public.fee_permanence not null default 'permanent',
  duration_days integer,
  effective_from date not null default current_date,
  scope public.fee_scope not null default 'all',
  selected_member_ids text[] not null default '{}'::text[],
  custom boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.fee_policies enable row level security;
drop trigger if exists trg_fee_policies_updated_at on public.fee_policies;
create trigger trg_fee_policies_updated_at before update on public.fee_policies
  for each row execute function public.tg_set_updated_at();

insert into public.fee_policies (key, label, amount, permanence, effective_from, scope, custom)
values
  ('membership', 'Membership Fee', 500, 'permanent', current_date, 'all', false),
  ('card', 'Membership Card', 500, 'permanent', current_date, 'all', false),
  ('sticker', 'Shop Sticker', 500, 'permanent', current_date, 'all', false)
on conflict (key) do nothing;

create table if not exists public.support_threads (
  id text primary key,
  member_id text not null references public.members(id) on delete cascade,
  member_name text not null,
  assigned_staff_id text references public.staff(id) on delete set null,
  status public.support_thread_status not null default 'open',
  subject text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.support_threads enable row level security;
create index if not exists idx_support_threads_status on public.support_threads(status, updated_at desc);
create index if not exists idx_support_threads_assigned on public.support_threads(assigned_staff_id, updated_at desc);
drop trigger if exists trg_support_threads_updated_at on public.support_threads;
create trigger trg_support_threads_updated_at before update on public.support_threads
  for each row execute function public.tg_set_updated_at();

create table if not exists public.support_messages (
  id text primary key,
  thread_id text not null references public.support_threads(id) on delete cascade,
  sender_kind public.support_sender_kind not null,
  sender_name text not null,
  sender_id text,
  text text not null,
  created_at timestamptz not null default now()
);
alter table public.support_messages enable row level security;
create index if not exists idx_support_messages_thread on public.support_messages(thread_id, created_at asc);
