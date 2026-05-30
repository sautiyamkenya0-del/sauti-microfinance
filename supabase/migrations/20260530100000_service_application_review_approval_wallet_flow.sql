alter table public.service_applications
  add column if not exists application_kind text not null default 'new';

alter table public.service_applications
  drop constraint if exists service_applications_application_kind_check;

alter table public.service_applications
  add constraint service_applications_application_kind_check
  check (application_kind in ('new','repeat'));

alter table public.service_applications
  drop constraint if exists service_applications_status_check;

alter table public.service_applications
  add constraint service_applications_status_check
  check (
    status in (
      'submitted',
      'verification',
      'financial_review',
      'waiver_approval',
      'final_approval',
      'approved',
      'billing',
      'processing',
      'completed',
      'cancelled',
      'under_review'
    )
  );

alter table public.service_applications
  drop constraint if exists service_applications_workflow_stage_check;

alter table public.service_applications
  add constraint service_applications_workflow_stage_check
  check (
    workflow_stage in (
      'application_submitted',
      'verification',
      'financial_review',
      'waiver_approval',
      'final_approval',
      'approved',
      'billing',
      'service_processing',
      'completed'
    )
  );

create or replace function public.sauti_ensure_service_wallet_for_member(
  target_member_id text,
  wallet_reserve_rules jsonb default '{}'::jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  if target_member_id is null or btrim(target_member_id) = '' then
    return;
  end if;

  insert into public.member_wallets (
    id,
    member_id,
    wallet_type,
    balance,
    withdrawable_balance,
    reserved_balance,
    locked_balance,
    reserve_rules
  )
  values (
    'WALLET-SERVICE-' || target_member_id,
    target_member_id,
    'service_wallet',
    0,
    0,
    0,
    0,
    coalesce(wallet_reserve_rules, '{}'::jsonb)
  )
  on conflict (member_id, wallet_type) do update
  set
    reserve_rules = coalesce(nullif(public.member_wallets.reserve_rules, '{}'::jsonb), excluded.reserve_rules),
    updated_at = now();

  insert into public.member_docket_balances (member_id, docket, amount, protected)
  values (target_member_id, 'service_wallet', 0, true)
  on conflict (member_id, docket) do update
  set protected = true,
      updated_at = now();
end;
$$;

create or replace function public.tg_service_application_ensure_wallet()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('approved','final_approval','billing','processing','completed')
     or new.workflow_stage in ('approved','final_approval','billing','service_processing','completed') then
    perform public.sauti_ensure_service_wallet_for_member(
      new.member_id,
      jsonb_build_object(
        'source', 'service_application_approval',
        'applicationId', new.id,
        'applicationNumber', new.application_number,
        'reservedBalanceDefaultPct', 20,
        'lockedBalanceDefaultPct', 30
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_service_application_ensure_wallet on public.service_applications;
create trigger trg_service_application_ensure_wallet
after insert or update of status, workflow_stage, member_id
on public.service_applications
for each row execute function public.tg_service_application_ensure_wallet();

notify pgrst, 'reload schema';
