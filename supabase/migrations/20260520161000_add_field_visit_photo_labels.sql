alter table public.field_visits
  add column if not exists photo_labels text[];
