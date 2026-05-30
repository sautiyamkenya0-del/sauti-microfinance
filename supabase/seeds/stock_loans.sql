-- SBC stock loan seed generated from SBC STOCK LOAN RECORDING DATA (1).xlsx.
-- Aggregates daily workbook rows into one open stock loan per member to satisfy one-open-loan-per-category guardrails.
-- The workbook is laid out as four side-by-side member ledgers: Alfred, Nancy, Hannah, and Majaliwa.
begin;

insert into public.members (id, name, phone, joined_at, status, member_category, member_tags, business_name, fee_membership, fee_card, fee_sticker)
values
  ('SBC0120K', 'ALFRED NZOHABONAYO', '0700000120', '2025-11-15'::date, 'active', 'stock', array['member','stock']::text[], 'Stock customer', true, true, true),
  ('SBC0406K', 'NANCY WAMBUKU', '0700000406', '2025-12-01'::date, 'active', 'stock', array['member','stock']::text[], 'Stock customer', true, true, true),
  ('SBC090K', 'HANNAH NYAMBURA', '0700000090', '2026-01-02'::date, 'active', 'stock', array['member','stock']::text[], 'Stock customer', true, true, true),
  ('SBC0423K', 'MARTIN MAJALIWA', '0700000423', '2026-01-26'::date, 'active', 'stock', array['member','stock']::text[], 'Stock customer', true, true, true)
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
  ('SBC0120K', 'ALFRED NZOHABONAYO', 83355.00, 4050.00, '2025-11-26'::date, '[{"date":"2025-11-26","stockLoan":5030.0,"stockCharge":200.0,"total":5230.0},{"date":"2025-11-27","stockLoan":2050.0,"stockCharge":200.0,"total":2250.0},{"date":"2025-11-29","stockLoan":3975.0,"stockCharge":200.0,"total":4175.0},{"date":"2025-12-01","stockLoan":3975.0,"stockCharge":200.0,"total":4175.0},{"date":"2025-12-02","stockLoan":3975.0,"stockCharge":250.0,"total":4225.0},{"date":"2025-12-06","stockLoan":3785.0,"stockCharge":200.0,"total":3985.0},{"date":"2025-12-07","stockLoan":3980.0,"stockCharge":200.0,"total":4180.0},{"date":"2025-12-08","stockLoan":10255.0,"stockCharge":200.0,"total":10455.0},{"date":"2025-12-11","stockLoan":3790.0,"stockCharge":100.0,"total":3890.0},{"date":"2026-01-02","stockLoan":2000.0,"stockCharge":100.0,"total":2100.0},{"date":"2026-01-02","stockLoan":2550.0,"stockCharge":200.0,"total":2750.0},{"date":"2026-01-08","stockLoan":4450.0,"stockCharge":200.0,"total":4650.0},{"date":"2026-01-10","stockLoan":4410.0,"stockCharge":200.0,"total":4610.0},{"date":"2026-01-12","stockLoan":4250.0,"stockCharge":200.0,"total":4450.0},{"date":"2026-01-26","stockLoan":4170.0,"stockCharge":200.0,"total":4370.0},{"date":"2026-01-27","stockLoan":4450.0,"stockCharge":200.0,"total":4650.0},{"date":"2026-01-28","stockLoan":2370.0,"stockCharge":200.0,"total":2570.0},{"date":"2026-01-31","stockLoan":9340.0,"stockCharge":300.0,"total":9640.0},{"date":"2026-02-05","stockLoan":2500.0,"stockCharge":300.0,"total":2800.0},{"date":"2026-02-12","stockLoan":2050.0,"stockCharge":200.0,"total":2250.0}]'::jsonb),
  ('SBC0406K', 'NANCY WAMBUKU', 83895.00, 4100.00, '2025-12-12'::date, '[{"date":"2025-12-12","stockLoan":3770.0,"stockCharge":200.0,"total":3970.0},{"date":"2025-12-17","stockLoan":1900.0,"stockCharge":200.0,"total":2100.0},{"date":"2025-12-18","stockLoan":4450.0,"stockCharge":200.0,"total":4650.0},{"date":"2025-12-22","stockLoan":4450.0,"stockCharge":200.0,"total":4650.0},{"date":"2026-01-05","stockLoan":6090.0,"stockCharge":200.0,"total":6290.0},{"date":"2026-01-08","stockLoan":2090.0,"stockCharge":200.0,"total":2290.0},{"date":"2026-01-10","stockLoan":4460.0,"stockCharge":200.0,"total":4660.0},{"date":"2026-01-13","stockLoan":4400.0,"stockCharge":200.0,"total":4600.0},{"date":"2026-01-16","stockLoan":4510.0,"stockCharge":200.0,"total":4710.0},{"date":"2026-01-19","stockLoan":4610.0,"stockCharge":200.0,"total":4810.0},{"date":"2026-01-21","stockLoan":4350.0,"stockCharge":200.0,"total":4550.0},{"date":"2026-01-23","stockLoan":7010.0,"stockCharge":200.0,"total":7210.0},{"date":"2026-01-26","stockLoan":1900.0,"stockCharge":200.0,"total":2100.0},{"date":"2026-01-29","stockLoan":8900.0,"stockCharge":200.0,"total":9100.0},{"date":"2026-02-04","stockLoan":6450.0,"stockCharge":200.0,"total":6650.0},{"date":"2026-02-10","stockLoan":4500.0,"stockCharge":200.0,"total":4700.0},{"date":"2026-02-16","stockLoan":3000.0,"stockCharge":300.0,"total":3300.0},{"date":"2026-02-16","stockLoan":2650.0,"stockCharge":200.0,"total":2850.0},{"date":"2026-02-18","stockLoan":2000.0,"stockCharge":200.0,"total":2200.0},{"date":"2026-03-07","stockLoan":2405.0,"stockCharge":200.0,"total":2605.0}]'::jsonb),
  ('SBC090K', 'HANNAH NYAMBURA', 3100.00, 300.00, '2026-01-02'::date, '[{"date":"2026-01-02","stockLoan":600.0,"stockCharge":100.0,"total":700.0},{"date":"2026-01-05","stockLoan":1900.0,"stockCharge":100.0,"total":2000.0},{"date":"2026-01-16","stockLoan":600.0,"stockCharge":100.0,"total":700.0}]'::jsonb),
  ('SBC0423K', 'MARTIN MAJALIWA', 8615.00, 500.00, '2026-01-26'::date, '[{"date":"2026-01-26","stockLoan":2045.0,"stockCharge":200.0,"total":2245.0},{"date":"2026-02-02","stockLoan":6570.0,"stockCharge":300.0,"total":6870.0}]'::jsonb);

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
