alter type public.member_category add value if not exists 'locomotive';
alter type public.member_category add value if not exists 'stock';
alter type public.member_category add value if not exists 'service';

alter table public.members
  add column if not exists share_reserve_balance numeric(14,2) not null default 0;

comment on column public.members.share_reserve_balance is
  'Pending mandatory share money below one full share unit. Converted into shares by the M-Pesa allocator once it reaches the share price.';
