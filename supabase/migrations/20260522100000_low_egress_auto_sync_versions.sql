-- Give the client a cheap, reliable way to detect changed data before
-- downloading the full app snapshot.

alter table if exists public.transactions add column if not exists updated_at timestamptz not null default now();
alter table if exists public.petty_cash add column if not exists updated_at timestamptz not null default now();
alter table if exists public.investors add column if not exists updated_at timestamptz not null default now();
alter table if exists public.attendance add column if not exists updated_at timestamptz not null default now();
alter table if exists public.appraisals add column if not exists updated_at timestamptz not null default now();
alter table if exists public.field_visits add column if not exists updated_at timestamptz not null default now();
alter table if exists public.followups add column if not exists updated_at timestamptz not null default now();
alter table if exists public.penalties add column if not exists updated_at timestamptz not null default now();
alter table if exists public.round_off add column if not exists updated_at timestamptz not null default now();
alter table if exists public.staff_messages add column if not exists updated_at timestamptz not null default now();
alter table if exists public.mpesa_events add column if not exists updated_at timestamptz not null default now();
alter table if exists public.mpesa_receipt_allocations add column if not exists updated_at timestamptz not null default now();

drop trigger if exists trg_transactions_updated_at on public.transactions;
create trigger trg_transactions_updated_at before update on public.transactions
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_petty_cash_updated_at on public.petty_cash;
create trigger trg_petty_cash_updated_at before update on public.petty_cash
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_investors_updated_at on public.investors;
create trigger trg_investors_updated_at before update on public.investors
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_attendance_updated_at on public.attendance;
create trigger trg_attendance_updated_at before update on public.attendance
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_appraisals_updated_at on public.appraisals;
create trigger trg_appraisals_updated_at before update on public.appraisals
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_field_visits_updated_at on public.field_visits;
create trigger trg_field_visits_updated_at before update on public.field_visits
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_followups_updated_at on public.followups;
create trigger trg_followups_updated_at before update on public.followups
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_penalties_updated_at on public.penalties;
create trigger trg_penalties_updated_at before update on public.penalties
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_round_off_updated_at on public.round_off;
create trigger trg_round_off_updated_at before update on public.round_off
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_staff_messages_updated_at on public.staff_messages;
create trigger trg_staff_messages_updated_at before update on public.staff_messages
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_mpesa_events_updated_at on public.mpesa_events;
create trigger trg_mpesa_events_updated_at before update on public.mpesa_events
  for each row execute function public.tg_set_updated_at();

drop trigger if exists trg_mpesa_receipt_allocations_updated_at on public.mpesa_receipt_allocations;
create trigger trg_mpesa_receipt_allocations_updated_at before update on public.mpesa_receipt_allocations
  for each row execute function public.tg_set_updated_at();
