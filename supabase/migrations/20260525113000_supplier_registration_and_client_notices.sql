alter type public.member_category add value if not exists 'supplier';

alter table public.suppliers
  add column if not exists member_id text references public.members(id) on delete set null,
  add column if not exists supplier_type text not null default 'individual',
  add column if not exists registration_category text not null default 'goods',
  add column if not exists individual_first_name text,
  add column if not exists individual_second_name text,
  add column if not exists individual_third_name text,
  add column if not exists national_id text,
  add column if not exists gender text,
  add column if not exists date_of_birth date,
  add column if not exists business_registration_number text,
  add column if not exists registration_date date,
  add column if not exists contact_person_designation text,
  add column if not exists alternative_phone text,
  add column if not exists email text,
  add column if not exists postal_address text,
  add column if not exists postal_code_town text,
  add column if not exists county text,
  add column if not exists sub_county_town text,
  add column if not exists physical_location text,
  add column if not exists kra_pin text,
  add column if not exists tax_compliance_certificate_number text,
  add column if not exists agpo_category text not null default 'not_applicable',
  add column if not exists regulatory_license_number text,
  add column if not exists bank_name text,
  add column if not exists bank_branch text,
  add column if not exists account_name text,
  add column if not exists account_number text,
  add column if not exists mpesa_paybill_till text,
  add column if not exists document_checklist jsonb not null default '{}'::jsonb;

create unique index if not exists idx_suppliers_member_id on public.suppliers(member_id)
where member_id is not null;

create index if not exists idx_suppliers_compliance_lookup
on public.suppliers(kra_pin, business_registration_number);

alter table public.staff_memos
  add column if not exists audience text not null default 'staff',
  add column if not exists notice_kind text not null default 'info',
  add column if not exists expires_at date;

create index if not exists idx_staff_memos_client_audience
on public.staff_memos(audience, memo_date desc, expires_at);
