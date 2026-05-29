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

with fuel(member_id, member_name, plate, fuel_amount, entry_count) as (
  values
    ('SBC0399K', 'JAMES GACHERU', 'KDQ 524R', 49600.00, 21),
    ('SBC0408K', 'MOSES NJENGA', 'KDC 229W', 34500.00, 12),
    ('SBC0402K', 'DAVID KARANJA', 'KDQ 717X', 12000.00, 4),
    ('SBC0401K', 'DENNIS OBWAYO', 'KMGR 067R', 2500.00, 4),
    ('SBC0410K', 'JAMES GATUMUTA', 'KDN 704B', 10000.00, 4),
    ('SBC0413K', 'LINDA WANJIRU', 'KDU 434P', 106905.00, 24),
    ('SBC0428K', 'PETER MUNDERU', 'KDC 259Z', 4500.00, 3),
    ('SBC0002K', 'LOISE NYAMBURA', 'KAX 542T', 13921.00, 3),
    ('SBC0425K', 'JAMES MURIRA', 'KDU139M', 51506.00, 15),
    ('SBC0429K', 'PETER KIRIITA', 'KDV 143G', 2500.00, 1),
    ('SBC0103K', 'EDDY KERE', 'KDD 037E', 4500.00, 3),
    ('SBC0458K', 'KEVIN MANYEKI', 'KDT 318X / KDW 221X', 12910.50, 4)
),
prepared as (
  select
    'LW-FUEL-' || member_id as loan_id,
    member_id,
    member_name,
    plate,
    fuel_amount,
    entry_count,
    entry_count * 100.00 as fuel_charge
  from fuel
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
  1,
  30,
  '2025-11-15',
  'active',
  'S1',
  0,
  'Lead Way Petrol Station fuel consumption reconciliation',
  'fuel',
  'SUP-LEAD-WAY-PETROL',
  'paid',
  jsonb_build_object(
    'supplierName', 'LEAD WAY PETROL STATION',
    'vehiclePlate', plate,
    'estimatedTotal', fuel_amount,
    'fuelCharge', fuel_charge,
    'productChargeAmount', fuel_charge,
    'sourceWorkbook', 'FUEL CONSUMPTION AND PAYMENT RECONCILIATION SHEET UPDATED.xlsx',
    'entryCount', entry_count,
    'jobCard', jsonb_build_object(
      'rows', jsonb_build_array(jsonb_build_object(
        'date', '2025-11-15',
        'fuelType', 'Fuel',
        'total', fuel_amount,
        'fuelCharge', fuel_charge,
        'vehiclePlate', plate,
        'attendantName', 'LEAD WAY PETROL STATION'
      ))
    )
  ),
  'S1',
  'Seeded from Lead Way reconciliation workbook'
from prepared
on conflict (id) do update set
  principal = excluded.principal,
  approved_amount = excluded.approved_amount,
  financed_principal_amount = excluded.financed_principal_amount,
  supplier_payload = excluded.supplier_payload,
  updated_at = now();

with fuel(member_id, fuel_amount) as (
  values
    ('SBC0399K', 49600.00), ('SBC0408K', 34500.00), ('SBC0402K', 12000.00),
    ('SBC0401K', 2500.00), ('SBC0410K', 10000.00), ('SBC0413K', 106905.00),
    ('SBC0428K', 4500.00), ('SBC0002K', 13921.00), ('SBC0425K', 51506.00),
    ('SBC0429K', 2500.00), ('SBC0103K', 4500.00), ('SBC0458K', 12910.50)
)
insert into public.supplier_fulfillment_requests (
  id, supplier_id, loan_id, member_id, kind, amount, detail, status,
  requested_by, fulfilled_by_name, fulfilled_at, commodity_name, unit_of_measure,
  vehicle_plate, fuel_type, driver_member_id, verified_at, verified_by_member_id,
  verification_note
)
select
  'SFR-' || member_id,
  'SUP-LEAD-WAY-PETROL',
  'LW-FUEL-' || member_id,
  member_id,
  'fuel',
  fuel_amount,
  jsonb_build_object('sourceWorkbook', 'FUEL CONSUMPTION AND PAYMENT RECONCILIATION SHEET UPDATED.xlsx'),
  'fulfilled',
  'S1',
  'LEAD WAY PETROL STATION',
  '2026-05-28 12:00:00+03',
  'Fuel',
  'KES',
  (select vehicle_plate from public.members where id = fuel.member_id),
  'Fuel',
  member_id,
  '2026-05-28 12:00:00+03',
  member_id,
  'Seeded as fulfilled from reconciliation workbook'
from fuel
on conflict (id) do update set
  amount = excluded.amount,
  status = excluded.status,
  detail = excluded.detail,
  updated_at = now();

with fuel(member_id, fuel_amount) as (
  values
    ('SBC0399K', 49600.00), ('SBC0408K', 34500.00), ('SBC0402K', 12000.00),
    ('SBC0401K', 2500.00), ('SBC0410K', 10000.00), ('SBC0413K', 106905.00),
    ('SBC0428K', 4500.00), ('SBC0002K', 13921.00), ('SBC0425K', 51506.00),
    ('SBC0429K', 2500.00), ('SBC0103K', 4500.00), ('SBC0458K', 12910.50)
)
insert into public.system_outflows (
  id, kind, amount, receiver_name, receiver_phone, method, supplier_id, loan_id,
  transaction_id, note, by_staff, created_at
)
select
  'OUT-LEADWAY-' || member_id,
  'supplier_payment',
  fuel_amount,
  'LEAD WAY PETROL STATION',
  '0700000000',
  'mpesa',
  'SUP-LEAD-WAY-PETROL',
  'LW-FUEL-' || member_id,
  null,
  'Sauti payment to Lead Way for member fuel consumption. Member owes Sauti through the linked fuel loan.',
  'S1',
  '2026-05-28 12:00:00+03'
from fuel
on conflict (id) do update set
  amount = excluded.amount,
  note = excluded.note;

commit;
