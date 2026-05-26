alter table public.members
  add column if not exists member_tags text[] not null default '{}'::text[];

update public.members
set member_tags = array_remove(array[
  case when member_category is not null then member_category::text else null end,
  case when coalesce(is_investor, false) then 'investor' else null end
], null)
where coalesce(array_length(member_tags, 1), 0) = 0;

create index if not exists idx_members_member_tags
on public.members using gin(member_tags);

comment on column public.members.member_tags is
  'Multi-role member flags such as member, investor, locomotive, stock, service, and supplier. member_category remains as the primary legacy category.';

alter table public.member_carryover_loans
  add column if not exists loan_kind text not null default 'financial';

comment on column public.member_carryover_loans.loan_kind is
  'Carryover product kind: financial, fuel, stock, or service. Product-specific metadata is stored in fee_breakdown.';

create index if not exists idx_member_carryover_loans_kind
on public.member_carryover_loans(loan_kind, member_id, start_date desc);
