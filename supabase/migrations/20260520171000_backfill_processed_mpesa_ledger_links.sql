do $$
declare
  row record;
  tx_id text;
begin
  for row in
    with confirmation_events as (
      select
        e.id,
        e.account,
        upper(trim(e.account)) as normalized_account,
        nullif(regexp_replace(e.account, '\D', '', 'g'), '') as account_digits,
        e.amount,
        e.mpesa_ref,
        e.payer_name,
        e.created_at,
        e.raw
      from public.mpesa_events e
      where e.kind = 'confirmation'
        and e.processed = true
        and e.transaction_id is null
        and coalesce(e.amount, 0) > 0
        and coalesce(trim(e.account), '') <> ''
        and coalesce(e.raw #>> '{Body,stkCallback,ResultCode}', '0') = '0'
    )
    select distinct on (e.id)
      e.id,
      e.normalized_account,
      e.amount,
      e.mpesa_ref,
      e.payer_name,
      e.created_at,
      m.id as member_id
    from confirmation_events e
    join public.members m
      on upper(m.id) = e.normalized_account
      or upper(coalesce(m.old_system_id, '')) = e.normalized_account
      or (
        e.account_digits is not null
        and upper(m.id) in (
          'SBC' || lpad(e.account_digits, 4, '0') || 'K',
          'M' || lpad(e.account_digits, 3, '0')
        )
      )
    order by e.id, m.id
  loop
    select t.id
      into tx_id
    from public.transactions t
    where t.ref is not distinct from row.mpesa_ref
      and upper(coalesce(t.account, '')) = row.normalized_account
      and t.amount = row.amount
    order by t.created_at desc
    limit 1;

    if tx_id is null then
      tx_id := public.next_entity_id('transactions');
      insert into public.transactions (
        id,
        date,
        type,
        amount,
        member_id,
        by_staff,
        note,
        ref,
        account,
        payer_name,
        created_at
      )
      values (
        tx_id,
        coalesce(row.created_at::date, current_date),
        'deposit',
        row.amount,
        row.member_id,
        'MPESA',
        'M-Pesa ledger backfill for processed confirmation',
        row.mpesa_ref,
        row.normalized_account,
        row.payer_name,
        row.created_at
      );
    end if;

    update public.mpesa_events
    set transaction_id = tx_id
    where id = row.id;
  end loop;
end $$;
