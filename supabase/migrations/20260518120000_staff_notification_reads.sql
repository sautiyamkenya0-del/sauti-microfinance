create table if not exists public.staff_notification_reads (
  staff_id text not null references public.staff(id) on delete cascade,
  notice_id text not null,
  read_at timestamptz not null default now(),
  primary key (staff_id, notice_id)
);

create index if not exists idx_staff_notification_reads_staff
  on public.staff_notification_reads(staff_id, read_at desc);

alter table public.staff_notification_reads enable row level security;
