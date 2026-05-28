alter table public.members
  add column if not exists vehicle_plate text;

create index if not exists idx_members_vehicle_plate
on public.members(vehicle_plate)
where vehicle_plate is not null;

comment on column public.members.vehicle_plate is
  'Default vehicle plate for locomotive members so fuel refill rows do not repeat the plate on every entry.';
