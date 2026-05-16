do $$ begin
  create type public.business_permanence as enum ('permanent','semi');
exception when duplicate_object then null; end $$;

alter table public.members
  add column if not exists second_name text,
  add column if not exists third_name text,
  add column if not exists business_permanence public.business_permanence;

update public.members
set
  second_name = coalesce(
    second_name,
    nullif(split_part(trim(coalesce(last_name, '')), ' ', 1), '')
  ),
  third_name = coalesce(
    third_name,
    nullif(
      trim(
        substring(
          trim(coalesce(last_name, ''))
          from position(' ' in trim(coalesce(last_name, ''))) + 1
        )
      ),
      ''
    )
  )
where coalesce(last_name, '') <> '';

update public.members
set
  business_permanence = 'permanent',
  fee_has_shop = true
where business_permanence is null
  and fee_has_shop = true;

update public.members
set
  business_permanence = 'semi',
  fee_has_shop = false,
  fee_sticker = false
where business_permanence = 'semi';
