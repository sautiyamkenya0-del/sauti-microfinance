-- Lead Way Petrol Station fuel reconciliation seed.
-- Source: FUEL CONSUMPTION AND PAYMENT RECONCILIATION SHEET UPDATED.xlsx.
-- Fuel amounts are supplier payments by Sauti; the related member balances remain fuel loans.

begin;

insert into public.members (id, name, phone, joined_at, status, member_category, member_tags, business_name, vehicle_plate, fee_membership, fee_card, fee_sticker)
values
  ('SUP0001K', 'LEAD WAY PETROL STATION', '0700000000', '2025-11-15', 'active', 'supplier', array['supplier']::text[], 'LEAD WAY PETROL STATION', null, true, true, true),
  ('SBC0399K', 'JAMES GACHERU', '0700000399', '2025-11-15', 'active', 'locomotive', array['locomotive']::text[], 'Fuel customer', 'KDQ 524R', true, true, true),
  ('SBC0408K', 'MOSES NJENGA', '0700000408', '2025-11-15', 'active', 'locomotive', array['locomotive']::text[], 'Fuel customer', 'KDC 229W', true, true, true),
  ('SBC0402K', 'DAVID KARANJA', '0700000402', '2025-11-15', 'active', 'locomotive', array['locomotive']::text[], 'Fuel customer', 'KDQ 717X', true, true, true),
  ('SBC0401K', 'DENNIS OBWAYO', '0700000401', '2025-11-15', 'active', 'locomotive', array['locomotive']::text[], 'Fuel customer', 'KMGR 067R', true, true, true),
  ('SBC0410K', 'JAMES GATUMUTA', '0700000410', '2025-11-15', 'active', 'locomotive', array['locomotive']::text[], 'Fuel customer', 'KDN 704B', true, true, true),
  ('SBC0413K', 'LINDA WANJIRU', '0700000413', '2025-11-15', 'active', 'locomotive', array['locomotive']::text[], 'Fuel customer', 'KDU 434P', true, true, true),
  ('SBC0428K', 'PETER MUNDERU', '0700000428', '2025-11-15', 'active', 'locomotive', array['locomotive']::text[], 'Fuel customer', 'KDC 259Z', true, true, true),
  ('SBC0002K', 'LOISE NYAMBURA KINITI', '0722240299', '2025-03-24', 'active', 'locomotive', array['locomotive']::text[], 'NYALOI ENTERPRISES', 'KAX 542T', true, true, true),
  ('SBC0425K', 'JAMES MURIRA', '0700000425', '2025-11-15', 'active', 'locomotive', array['locomotive']::text[], 'Fuel customer', 'KDU139M', true, true, true),
  ('SBC0429K', 'PETER KIRIITA', '0700000429', '2025-11-15', 'active', 'locomotive', array['locomotive']::text[], 'Fuel customer', 'KDV 143G', true, true, true),
  ('SBC0103K', 'Kere Eddie Kimiti', '0710459412', '2025-03-31', 'active', 'locomotive', array['locomotive']::text[], 'county carwash', 'KDD 037E', true, true, true),
  ('SBC0458K', 'KEVIN MANYEKI', '0700000458', '2025-11-15', 'active', 'locomotive', array['locomotive']::text[], 'Fuel customer', 'KDT 318X / KDW 221X', true, true, true)
on conflict (id) do update set
  member_category = excluded.member_category,
  member_tags = excluded.member_tags,
  vehicle_plate = coalesce(public.members.vehicle_plate, excluded.vehicle_plate),
  updated_at = now();

insert into public.suppliers (
  id, name, kind, phone, contact_person, location, notes, status, member_id,
  supplier_type, registration_category, business_registration_number,
  physical_location, mpesa_paybill_till, supplier_class
)
values (
  'SUP-LEAD-WAY-PETROL',
  'LEAD WAY PETROL STATION',
  'fuel',
  '0700000000',
  'Accounts',
  'Kiambu',
  'Seeded from fuel consumption and payment reconciliation workbook.',
  'active',
  'SUP0001K',
  'company',
  'goods',
  'LEAD-WAY-PETROL',
  'Kiambu',
  'LEADWAY',
  'normal'
)
on conflict (id) do update set
  name = excluded.name,
  kind = excluded.kind,
  member_id = excluded.member_id,
  notes = excluded.notes,
  updated_at = now();

insert into public.supplier_inventory_items (id, supplier_id, item_name, item_kind, unit, quantity_available, unit_price, sku, notes)
values
  ('INV-LEAD-WAY-FUEL', 'SUP-LEAD-WAY-PETROL', 'Fuel', 'fuel', 'KES', 0, 1, 'LEADWAY-FUEL', 'Open fuel credit line from reconciliation seed.')
on conflict (id) do update set
  supplier_id = excluded.supplier_id,
  item_name = excluded.item_name,
  item_kind = excluded.item_kind,
  unit = excluded.unit,
  unit_price = excluded.unit_price,
  notes = excluded.notes,
  updated_at = now();

create temp table lead_way_fuel_seed (
  row_order integer primary key,
  member_id text not null,
  member_name text not null,
  plate text not null,
  fuel_amount numeric(12,2) not null,
  entry_date date not null
) on commit drop;

insert into lead_way_fuel_seed (row_order, member_id, member_name, plate, fuel_amount, entry_date)
values
    (1, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-11-15'::date),
    (2, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 3000.00, '2025-11-16'::date),
    (3, 'SBC0399K', 'JAMES GACHERU', '', 2600.00, '2025-11-17'::date),
    (4, 'SBC0399K', 'JAMES GACHERU', '', 4000.00, '2025-11-18'::date),
    (5, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-11-20'::date),
    (6, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 4000.00, '2025-11-21'::date),
    (7, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-11-22'::date),
    (8, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-11-24'::date),
    (9, 'SBC0401K', 'DENNIS   OBWAYO', 'KMGR 067R', 1000.00, '2025-11-24'::date),
    (10, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-11-25'::date),
    (11, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-11-26'::date),
    (12, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-11-28'::date),
    (13, 'SBC0402K', 'DAVID KARANJA', 'KDQ 717X', 3000.00, '2025-11-28'::date),
    (14, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-11-29'::date),
    (15, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-11-30'::date),
    (16, 'SBC0402K', 'DAVID KARANJA', 'KDQ 717X', 3000.00, '2025-11-30'::date),
    (17, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-01-12'::date),
    (18, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-06-12'::date),
    (19, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-08-12'::date),
    (20, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 3000.00, '2025-10-12'::date),
    (21, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-11-12'::date),
    (22, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-12-12'::date),
    (23, 'SBC0402K', 'DAVID KARANJA', 'KDQ 717X', 3000.00, '2025-12-13'::date),
    (24, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 2000.00, '2025-12-14'::date),
    (25, 'SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 3000.00, '2025-12-16'::date),
    (26, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 2000.00, '2025-12-16'::date),
    (27, 'SBC0402K', 'DAVID KARANJA', 'KDQ 717X', 3000.00, '2025-12-16'::date),
    (28, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 2500.00, '2025-12-17'::date),
    (29, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 3000.00, '2025-12-18'::date),
    (30, 'SBC0410K', 'JAMES GATUMUTA', 'KDN 704B', 3000.00, '2025-12-18'::date),
    (31, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 3000.00, '2025-12-19'::date),
    (32, 'SBC0410K', 'JAMES GATUMUTA', 'KDN 704B', 3000.00, '2025-12-20'::date),
    (33, 'SBC0408K', 'MOSES NJENGA', 'KDC229W', 3000.00, '2025-12-21'::date),
    (34, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 3000.00, '2025-12-23'::date),
    (35, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 3000.00, '2025-12-24'::date),
    (36, 'SBC0410K', 'JAMES GATUMUTA', 'KDN 704B', 2000.00, '2025-12-24'::date),
    (37, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 3000.00, '2025-12-26'::date),
    (38, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 3000.00, '2025-12-28'::date),
    (39, 'SBC0410K', 'JAMES GATUMUTA', 'KDN 704B', 2000.00, '2025-12-31'::date),
    (40, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 3000.00, '2026-01-01'::date),
    (41, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 3000.00, '2026-03-01'::date),
    (42, 'SBC0401K', 'DENNIS   OBWAYO', 'KMGR 067R', 500.00, '2026-03-01'::date),
    (43, 'SBC0408K', 'MOSES NJENGA', 'KDC 229W', 3000.00, '2026-06-01'::date),
    (44, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 3000.00, '2026-06-01'::date),
    (45, 'SBC0002K', 'LOISE NYAMBURA', 'KAX 542T', 5008.00, '2026-08-01'::date),
    (46, 'SBC0401K', 'DENNIS   OBWAYO', 'KMGR 067R', 500.00, '2026-01-13'::date),
    (47, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 1500.00, '2026-01-13'::date),
    (48, 'SBC0401K', 'DENNIS   OBWAYO', 'KMGR 067R', 500.00, '2026-01-14'::date),
    (49, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 7060.00, '2026-01-16'::date),
    (50, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2612.00, '2026-01-17'::date),
    (51, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 3000.00, '2026-01-20'::date),
    (52, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 3500.00, '2026-01-21'::date),
    (53, 'SBC0428K', 'PETER MUNDERU', 'KDC 259Z', 1500.00, '2026-01-22'::date),
    (54, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 3500.00, '2026-01-22'::date),
    (55, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 3500.00, '2026-01-23'::date),
    (56, 'SBC0429K', 'PETER KIRIITA', 'KDV 143G', 2500.00, '2026-01-23'::date),
    (57, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 4388.00, '2026-01-26'::date),
    (58, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 39823.00, '2026-01-28'::date),
    (59, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 2500.00, '2026-01-28'::date),
    (60, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 3500.00, '2026-01-29'::date),
    (61, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2500.00, '2026-01-31'::date),
    (62, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2500.00, '2026-02-02'::date),
    (63, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 5921.00, '2026-02-02'::date),
    (64, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 4000.00, '2026-02-04'::date),
    (65, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 2110.00, '2026-02-04'::date),
    (66, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 7475.00, '2026-02-09'::date),
    (67, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2500.00, '2026-02-19'::date),
    (68, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 3500.00, '2026-02-20'::date),
    (69, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2000.00, '2026-02-21'::date),
    (70, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2500.00, '2026-02-23'::date),
    (71, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2500.00, '2026-02-24'::date),
    (72, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 3500.00, '2026-02-24'::date),
    (73, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 3000.00, '2026-02-25'::date),
    (74, 'SBC0103K', 'EDDY KERE', 'KDD 037E', 2000.00, '2026-02-25'::date),
    (75, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 3000.00, '2026-02-26'::date),
    (76, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 1000.00, '2026-02-26'::date),
    (77, 'SBC0002K', 'LOISE NYAMBURA', 'KAX 542T', 5910.00, '2026-02-27'::date),
    (78, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 3000.00, '2026-02-28'::date),
    (79, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2500.00, '2026-03-02'::date),
    (80, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2500.00, '2026-03-03'::date),
    (81, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 3500.00, '2026-03-10'::date),
    (82, 'SBC0425K', 'JAMES MURIRA', 'KDU139M', 3000.00, '2026-03-10'::date),
    (83, 'SBC0428K', 'PETER MUNDERU', 'KDC 259Z', 1500.00, '2026-03-11'::date),
    (84, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 1500.00, '2026-03-12'::date),
    (85, 'SBC0428K', 'PETER MUNDERU', 'KDC 259Z', 1500.00, '2026-03-12'::date),
    (86, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2500.00, '2026-03-13'::date),
    (87, 'SBC0002K', 'LOISE NYAMBURA', 'KAX 542T', 3003.00, '2026-03-13'::date),
    (88, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 3500.00, '2026-03-14'::date),
    (89, 'SBC0103K', 'EDDY KERE', 'KDD 037E', 1000.00, '2026-03-16'::date),
    (90, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2500.00, '2026-03-19'::date),
    (91, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2674.00, '2026-03-20'::date),
    (92, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2674.00, '2026-03-21'::date),
    (93, 'SBC0103K', 'EDDY KERE', 'KDD 037E', 1500.00, '2026-03-24'::date),
    (94, 'SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 2674.00, '2026-03-26'::date),
    (95, 'SBC0458K', 'KEVIN MANYEKI', 'KDT 318X', 2500.00, '2026-04-02'::date),
    (96, 'SBC0458K', 'KEVIN MANYEKI', 'KDT 318X', 3000.00, '2026-04-03'::date),
    (97, 'SBC0458K', 'KEVIN MANYEKI', 'KDW 221X', 4410.50, '2026-05-02'::date),
    (98, 'SBC0458K', 'KEVIN MANYEKI', 'KDW 221X', 3000.00, '2026-05-06'::date);

-- Remove legacy Lead Way rows whose IDs collapsed transactions by member/date only.
delete from public.system_outflows
where supplier_id = 'SUP-LEAD-WAY-PETROL'
  and note like 'Sauti payment to Lead Way%';

delete from public.supplier_fulfillment_requests
where supplier_id = 'SUP-LEAD-WAY-PETROL'
  and detail->>'sourceWorkbook' = 'FUEL CONSUMPTION AND PAYMENT RECONCILIATION SHEET UPDATED.xlsx';

delete from public.loans
where supplier_id = 'SUP-LEAD-WAY-PETROL'
  and supplier_payload->>'sourceWorkbook' = 'FUEL CONSUMPTION AND PAYMENT RECONCILIATION SHEET UPDATED.xlsx';

with prepared as (
  select
    'LW-FUEL-' || member_id || '-ACCOUNT' as loan_id,
    row_order,
    member_id,
    member_name,
    plate,
    fuel_amount,
    entry_date,
    100.00::numeric(12,2) as fuel_charge
  from lead_way_fuel_seed
),
grouped as (
  select
    loan_id,
    member_id,
    min(entry_date) as first_entry_date,
    max(entry_date) as last_entry_date,
    sum(fuel_amount)::numeric(12,2) as fuel_amount,
    sum(fuel_charge)::numeric(12,2) as fuel_charge,
    jsonb_agg(
      jsonb_build_object(
        'date', entry_date,
        'fuelType', 'Fuel',
        'total', fuel_amount,
        'fuelCharge', fuel_charge,
        'vehiclePlate', plate,
        'attendantName', 'LEAD WAY PETROL STATION',
        'seedRow', row_order
      )
      order by entry_date, row_order
    ) as fuel_rows,
    jsonb_agg(row_order order by entry_date, row_order) as seed_rows
  from prepared
  group by loan_id, member_id
)
insert into public.loans (
  id, member_id, principal, approved_amount, financed_principal_amount,
  net_disbursed_amount, processing_fee_amount, insurance_fee_amount, transaction_fee_amount,
  processing_fee_mode, insurance_fee_mode, disbursement_status, rate, term_months, term_days,
  start_date, status, officer_id, paid, purpose, loan_kind, supplier_id,
  supplier_request_status, supplier_payload, reviewed_by, review_note
)
select
  loan_id,
  member_id,
  fuel_amount,
  fuel_amount,
  fuel_amount + fuel_charge,
  0,
  0,
  0,
  0,
  'upfront',
  'upfront',
  'paid',
  0,
  0,
  1,
  first_entry_date,
  'active',
  'S1',
  0,
  'Lead Way Petrol Station fuel consumption reconciliation',
  'fuel',
  'SUP-LEAD-WAY-PETROL',
  'paid',
  jsonb_build_object(
    'supplierName', 'LEAD WAY PETROL STATION',
    'vehiclePlate', null,
    'estimatedTotal', fuel_amount,
    'fuelCharge', fuel_charge,
    'productChargeAmount', fuel_charge,
    'sourceWorkbook', 'FUEL CONSUMPTION AND PAYMENT RECONCILIATION SHEET UPDATED.xlsx',
    'entryDate', first_entry_date,
    'lastEntryDate', last_entry_date,
    'seedRows', seed_rows,
    'jobCard', jsonb_build_object('rows', fuel_rows)
  ),
  'S1',
  'Seeded from Lead Way reconciliation workbook'
from grouped
on conflict (id) do update set
  principal = excluded.principal,
  approved_amount = excluded.approved_amount,
  financed_principal_amount = excluded.financed_principal_amount,
  supplier_payload = excluded.supplier_payload,
  updated_at = now();

with prepared as (
  select
    'LW-FUEL-' || member_id || '-ACCOUNT' as loan_id,
    'SFR-' || member_id || '-' || to_char(entry_date,'YYYYMMDD') || '-' || lpad(row_order::text, 4, '0') as request_id,
    row_order,
    member_id,
    plate,
    fuel_amount,
    entry_date
  from lead_way_fuel_seed
)
insert into public.supplier_fulfillment_requests (
  id, supplier_id, loan_id, member_id, kind, amount, detail, status,
  requested_by, fulfilled_by_name, fulfilled_at, commodity_name, unit_of_measure,
  vehicle_plate, fuel_type, driver_member_id, verified_at, verified_by_member_id,
  verification_note
)
select
  request_id,
  'SUP-LEAD-WAY-PETROL',
  loan_id,
  member_id,
  'fuel',
  fuel_amount,
  jsonb_build_object(
    'sourceWorkbook', 'FUEL CONSUMPTION AND PAYMENT RECONCILIATION SHEET UPDATED.xlsx',
    'entryDate', entry_date,
    'seedRow', row_order,
    'fuelCharge', 100.00
  ),
  'fulfilled',
  'S1',
  'LEAD WAY PETROL STATION',
  now(),
  'Fuel',
  'KES',
  plate,
  'Fuel',
  member_id,
  now(),
  member_id,
  'Seeded as fulfilled from reconciliation workbook'
from prepared
on conflict (id) do update set
  loan_id = excluded.loan_id,
  amount = excluded.amount,
  status = excluded.status,
  detail = excluded.detail,
  updated_at = now();

with prepared as (
  select
    'LW-FUEL-' || member_id || '-ACCOUNT' as loan_id,
    'OUT-LEADWAY-' || member_id || '-' || to_char(entry_date,'YYYYMMDD') || '-' || lpad(row_order::text, 4, '0') as outflow_id,
    row_order,
    member_id,
    fuel_amount,
    entry_date
  from lead_way_fuel_seed
)
insert into public.system_outflows (
  id, kind, amount, receiver_name, receiver_phone, method, supplier_id, loan_id,
  transaction_id, note, by_staff, created_at
)
select
  outflow_id,
  'supplier_payment',
  fuel_amount,
  'LEAD WAY PETROL STATION',
  '0700000000',
  'mpesa',
  'SUP-LEAD-WAY-PETROL',
  loan_id,
  null,
  'Sauti payment to Lead Way for member fuel consumption. Member owes Sauti through the linked fuel loan. Seed row ' || row_order || '.',
  'S1',
  now()
from prepared
on conflict (id) do update set
  loan_id = excluded.loan_id,
  amount = excluded.amount,
  note = excluded.note;

commit;
