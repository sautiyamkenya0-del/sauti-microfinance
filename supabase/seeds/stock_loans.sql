-- SBC stock loan seed generated from SBC STOCK LOAN RECORDING DATA (1).xlsx.
-- Aggregates daily workbook rows into one open stock loan per member to satisfy one-open-loan-per-category guardrails.
begin;

insert into public.members (id, name, phone, joined_at, status, member_category, member_tags, business_name, fee_membership, fee_card, fee_sticker)
values
  ('SBC0120K', 'ALFRED NZOHABONAYO', '0700000120', '2025-11-15'::date, 'active', 'stock', array['member','stock']::text[], 'Stock customer', true, true, true)
on conflict (id) do update set
  name = excluded.name,
  member_category = excluded.member_category,
  member_tags = array(select distinct unnest(coalesce(public.members.member_tags, '{}'::text[]) || excluded.member_tags)),
  updated_at = now();

insert into public.suppliers (id, name, kind, phone, contact_person, location, notes, status)
values ('SUP-SBC-STOCK', 'SBC STOCK SUPPLIER', 'stock', '0700000000', 'Accounts', 'Kiambu', 'Seeded from stock loan workbook.', 'active')
on conflict (id) do update set name = excluded.name, kind = excluded.kind, notes = excluded.notes, updated_at = now();

create temp table stock_seed (
  member_id text not null,
  member_name text not null,
  principal numeric(14,2) not null,
  charge numeric(14,2) not null,
  start_date date not null,
  entries jsonb not null
) on commit drop;

insert into stock_seed (member_id, member_name, principal, charge, start_date, entries)
values
  ('SBC0120K', 'ALFRED NZOHABONAYO', 83355.00, 4050.00, '2025-11-26'::date, '[{"date":"2025-11-26","stockLoan":5030.0,"stockCharge":200.0,"total":5230.0},{"date":"2025-11-27","stockLoan":2050.0,"stockCharge":200.0,"total":2250.0},{"date":"2025-11-29","stockLoan":3975.0,"stockCharge":200.0,"total":4175.0},{"date":"2025-12-01","stockLoan":3975.0,"stockCharge":200.0,"total":4175.0},{"date":"2025-12-02","stockLoan":3975.0,"stockCharge":250.0,"total":4225.0},{"date":"2025-12-06","stockLoan":3785.0,"stockCharge":200.0,"total":3985.0},{"date":"2025-12-07","stockLoan":3980.0,"stockCharge":200.0,"total":4180.0},{"date":"2025-12-08","stockLoan":10255.0,"stockCharge":200.0,"total":10455.0},{"date":"2025-12-11","stockLoan":3790.0,"stockCharge":100.0,"total":3890.0},{"date":"2026-01-02","stockLoan":2000.0,"stockCharge":100.0,"total":2100.0},{"date":"2026-01-02","stockLoan":2550.0,"stockCharge":200.0,"total":2750.0},{"date":"2026-01-08","stockLoan":4450.0,"stockCharge":200.0,"total":4650.0},{"date":"2026-01-10","stockLoan":4410.0,"stockCharge":200.0,"total":4610.0},{"date":"2026-01-12","stockLoan":4250.0,"stockCharge":200.0,"total":4450.0},{"date":"2026-01-26","stockLoan":4170.0,"stockCharge":200.0,"total":4370.0},{"date":"2026-01-27","stockLoan":4450.0,"stockCharge":200.0,"total":4650.0},{"date":"2026-01-28","stockLoan":2370.0,"stockCharge":200.0,"total":2570.0},{"date":"2026-01-31","stockLoan":9340.0,"stockCharge":300.0,"total":9640.0},{"date":"2026-02-05","stockLoan":2500.0,"stockCharge":300.0,"total":2800.0},{"date":"2026-02-12","stockLoan":2050.0,"stockCharge":200.0,"total":2250.0}]'::jsonb);

insert into public.loans (id, member_id, principal, approved_amount, rate, term_months, term_days, start_date, status, paid, purpose, loan_kind, supplier_id, supplier_request_status, supplier_payload)
select
  'STOCK-' || member_id || '-' || to_char(start_date, 'YYYYMMDD'), member_id, principal, principal, 0, 0, 1, start_date, 'active', 0,
  'SBC stock loan workbook import', 'stock', 'SUP-SBC-STOCK', 'fulfilled',
  jsonb_build_object('source','SBC STOCK LOAN RECORDING DATA (1).xlsx','memberName',member_name,'stockCharge',charge,'entries',entries)
from stock_seed
on conflict (id) do update set
  principal = excluded.principal, approved_amount = excluded.approved_amount, supplier_payload = excluded.supplier_payload, updated_at = now();

insert into public.supplier_fulfillment_requests (id, supplier_id, loan_id, member_id, kind, amount, detail, status, fulfilled_at, commodity_name, unit_of_measure)
select 'SFR-STOCK-' || member_id || '-' || to_char(start_date, 'YYYYMMDD'), 'SUP-SBC-STOCK', 'STOCK-' || member_id || '-' || to_char(start_date, 'YYYYMMDD'), member_id, 'stock', principal,
  jsonb_build_object('source','SBC STOCK LOAN RECORDING DATA (1).xlsx','stockCharge',charge,'entries',entries), 'fulfilled', start_date::timestamptz, 'Stock/Goods', 'KES'
from stock_seed
on conflict (id) do update set amount = excluded.amount, detail = excluded.detail, updated_at = now();

commit;
