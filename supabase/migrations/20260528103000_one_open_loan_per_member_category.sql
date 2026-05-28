create or replace function public.tg_reject_duplicate_open_carryover_loan()
returns trigger
language plpgsql
as $$
declare
  normalized_kind text := coalesce(nullif(new.loan_kind, ''), 'financial');
begin
  if coalesce(new.finished, false) = true or new.status not in ('active', 'defaulted') then
    return new;
  end if;

  if exists (
    select 1
    from public.loans l
    where l.member_id = new.member_id
      and coalesce(nullif(l.loan_kind, ''), 'financial') = normalized_kind
      and l.status in ('pending', 'active', 'defaulted')
  ) then
    raise exception 'Member % already has an open % loan.', new.member_id, normalized_kind;
  end if;

  if exists (
    select 1
    from public.member_carryover_loans cl
    where cl.member_id = new.member_id
      and coalesce(nullif(cl.loan_kind, ''), 'financial') = normalized_kind
      and cl.status in ('active', 'defaulted')
      and coalesce(cl.finished, false) = false
      and cl.id <> new.id
  ) then
    raise exception 'Member % already has an open % carryover loan.', new.member_id, normalized_kind;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_member_carryover_loans_reject_duplicate_open
on public.member_carryover_loans;

create trigger trg_member_carryover_loans_reject_duplicate_open
before insert or update of member_id, status, loan_kind, finished
on public.member_carryover_loans
for each row
execute function public.tg_reject_duplicate_open_carryover_loan();

create or replace view public.financial_invariant_violations as
with settings as (
  select
    public.sauti_policy_numeric('mandatorySavingsThreshold', 5000) as savings_threshold,
    public.sauti_policy_numeric('mandatorySharesThreshold', 3000) as shares_threshold
),
ledger_net as (
  select
    member_id,
    sum(
      case
        when type in ('deposit', 'loan_repayment', 'share_purchase', 'fee_payment', 'investor_contribution')
          then amount
        when type in ('withdrawal', 'loan_disbursement')
          then -amount
        else 0
      end
    ) as net_amount
  from public.transactions
  where member_id is not null
  group by member_id
),
carryover_net as (
  select
    member_id,
    greatest(
      coalesce(total_collected, 0),
      case
        when (collection_breakdown ->> 'totalDepositsRecorded') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then (collection_breakdown ->> 'totalDepositsRecorded')::numeric
        else 0
      end
    ) as net_amount
  from public.member_carryover_profiles
),
docket_totals as (
  select
    member_id,
    sum(amount) filter (where docket = 'purpose_pool') as purpose_pool,
    sum(amount) filter (where docket <> 'purpose_pool') as other_dockets
  from public.member_docket_balances
  group by member_id
),
member_positions as (
  select
    m.id as member_id,
    m.savings_balance,
    (m.shares * 100) + m.share_reserve_balance as share_basket,
    coalesce(d.purpose_pool, 0) as purpose_pool,
    coalesce(d.other_dockets, 0) as other_dockets,
    greatest(coalesce(l.net_amount, 0), coalesce(c.net_amount, 0)) as lifetime_net
  from public.members m
  left join ledger_net l on l.member_id = m.id
  left join carryover_net c on c.member_id = m.id
  left join docket_totals d on d.member_id = m.id
),
open_loans as (
  select
    id,
    member_id,
    coalesce(nullif(loan_kind, ''), 'financial') as loan_kind,
    'live'::text as source
  from public.loans
  where status in ('pending', 'active', 'defaulted')
  union all
  select
    id,
    member_id,
    coalesce(nullif(loan_kind, ''), 'financial') as loan_kind,
    'carryover'::text as source
  from public.member_carryover_loans
  where status in ('active', 'defaulted')
    and coalesce(finished, false) = false
),
duplicate_open_loans as (
  select
    member_id,
    loan_kind,
    jsonb_agg(jsonb_build_object('id', id, 'source', source) order by source, id) as loans
  from open_loans
  group by member_id, loan_kind
  having count(*) > 1
)
select
  'negative_member_balance'::text as violation,
  mp.member_id,
  jsonb_build_object(
    'savingsBalance', mp.savings_balance,
    'shareBasket', mp.share_basket
  ) as details
from member_positions mp
where mp.savings_balance < 0
   or mp.share_basket < 0
union all
select
  'mandatory_savings_above_threshold'::text as violation,
  mp.member_id,
  jsonb_build_object(
    'savingsBalance', mp.savings_balance,
    'threshold', s.savings_threshold
  ) as details
from member_positions mp
cross join settings s
where mp.savings_balance > s.savings_threshold
union all
select
  'shares_above_threshold'::text as violation,
  mp.member_id,
  jsonb_build_object(
    'shareBasket', mp.share_basket,
    'threshold', s.shares_threshold
  ) as details
from member_positions mp
cross join settings s
where mp.share_basket > s.shares_threshold
union all
select
  'purpose_pool_above_lifetime_net'::text as violation,
  mp.member_id,
  jsonb_build_object(
    'lifetimeNet', mp.lifetime_net,
    'mandatoryAndOtherHeld', mp.savings_balance + mp.share_basket + mp.other_dockets,
    'purposePool', mp.purpose_pool
  ) as details
from member_positions mp
where mp.purpose_pool > greatest(0, mp.lifetime_net - mp.savings_balance - mp.share_basket - mp.other_dockets)
union all
select
  'duplicate_open_loans'::text as violation,
  member_id,
  jsonb_build_object('loanKind', loan_kind, 'loans', loans) as details
from duplicate_open_loans;
