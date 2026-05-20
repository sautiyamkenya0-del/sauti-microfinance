with fee_band_defaults as (
  select jsonb_build_array(
    jsonb_build_object('id', 'tx-001', 'minAmount', 0, 'maxAmount', 100, 'feeAmount', 0, 'label', '0 - 100'),
    jsonb_build_object('id', 'tx-002', 'minAmount', 101, 'maxAmount', 500, 'feeAmount', 7, 'label', '101 - 500'),
    jsonb_build_object('id', 'tx-003', 'minAmount', 501, 'maxAmount', 1000, 'feeAmount', 13, 'label', '501 - 1,000'),
    jsonb_build_object('id', 'tx-004', 'minAmount', 1001, 'maxAmount', 1500, 'feeAmount', 23, 'label', '1,001 - 1,500'),
    jsonb_build_object('id', 'tx-005', 'minAmount', 1501, 'maxAmount', 2500, 'feeAmount', 33, 'label', '1,501 - 2,500'),
    jsonb_build_object('id', 'tx-006', 'minAmount', 2501, 'maxAmount', 3500, 'feeAmount', 53, 'label', '2,501 - 3,500'),
    jsonb_build_object('id', 'tx-007', 'minAmount', 3501, 'maxAmount', 5000, 'feeAmount', 57, 'label', '3,501 - 5,000'),
    jsonb_build_object('id', 'tx-008', 'minAmount', 5001, 'maxAmount', 7500, 'feeAmount', 78, 'label', '5,001 - 7,500'),
    jsonb_build_object('id', 'tx-009', 'minAmount', 7501, 'maxAmount', 10000, 'feeAmount', 90, 'label', '7,501 - 10,000'),
    jsonb_build_object('id', 'tx-010', 'minAmount', 10001, 'maxAmount', 15000, 'feeAmount', 100, 'label', '10,001 - 15,000'),
    jsonb_build_object('id', 'tx-011', 'minAmount', 15001, 'maxAmount', 20000, 'feeAmount', 105, 'label', '15,001 - 20,000'),
    jsonb_build_object('id', 'tx-012', 'minAmount', 20001, 'maxAmount', 35000, 'feeAmount', 108, 'label', '20,001 - 35,000'),
    jsonb_build_object('id', 'tx-013', 'minAmount', 35001, 'maxAmount', 50000, 'feeAmount', 108, 'label', '35,001 - 50,000'),
    jsonb_build_object('id', 'tx-014', 'minAmount', 50001, 'maxAmount', 250000, 'feeAmount', 108, 'label', '50,001 - 250,000')
  ) as value
)
insert into public.policy_settings (key, label, value, notes)
select
  'transaction_fee_bands',
  'Transaction fee bands',
  value,
  'Editable fixed transaction-fee brackets used when pricing loans.'
from fee_band_defaults
on conflict (key) do nothing;

with fee_band_defaults as (
  select jsonb_build_array(
    jsonb_build_object('id', 'tx-001', 'minAmount', 0, 'maxAmount', 100, 'feeAmount', 0, 'label', '0 - 100'),
    jsonb_build_object('id', 'tx-002', 'minAmount', 101, 'maxAmount', 500, 'feeAmount', 7, 'label', '101 - 500'),
    jsonb_build_object('id', 'tx-003', 'minAmount', 501, 'maxAmount', 1000, 'feeAmount', 13, 'label', '501 - 1,000'),
    jsonb_build_object('id', 'tx-004', 'minAmount', 1001, 'maxAmount', 1500, 'feeAmount', 23, 'label', '1,001 - 1,500'),
    jsonb_build_object('id', 'tx-005', 'minAmount', 1501, 'maxAmount', 2500, 'feeAmount', 33, 'label', '1,501 - 2,500'),
    jsonb_build_object('id', 'tx-006', 'minAmount', 2501, 'maxAmount', 3500, 'feeAmount', 53, 'label', '2,501 - 3,500'),
    jsonb_build_object('id', 'tx-007', 'minAmount', 3501, 'maxAmount', 5000, 'feeAmount', 57, 'label', '3,501 - 5,000'),
    jsonb_build_object('id', 'tx-008', 'minAmount', 5001, 'maxAmount', 7500, 'feeAmount', 78, 'label', '5,001 - 7,500'),
    jsonb_build_object('id', 'tx-009', 'minAmount', 7501, 'maxAmount', 10000, 'feeAmount', 90, 'label', '7,501 - 10,000'),
    jsonb_build_object('id', 'tx-010', 'minAmount', 10001, 'maxAmount', 15000, 'feeAmount', 100, 'label', '10,001 - 15,000'),
    jsonb_build_object('id', 'tx-011', 'minAmount', 15001, 'maxAmount', 20000, 'feeAmount', 105, 'label', '15,001 - 20,000'),
    jsonb_build_object('id', 'tx-012', 'minAmount', 20001, 'maxAmount', 35000, 'feeAmount', 108, 'label', '20,001 - 35,000'),
    jsonb_build_object('id', 'tx-013', 'minAmount', 35001, 'maxAmount', 50000, 'feeAmount', 108, 'label', '35,001 - 50,000'),
    jsonb_build_object('id', 'tx-014', 'minAmount', 50001, 'maxAmount', 250000, 'feeAmount', 108, 'label', '50,001 - 250,000')
  ) as value
)
update public.policy_settings as ps
set
  value = fee_band_defaults.value,
  notes = 'Editable fixed transaction-fee brackets used when pricing loans.',
  updated_at = now()
from fee_band_defaults
where ps.key = 'transaction_fee_bands'
  and (
    ps.value is null
    or jsonb_typeof(ps.value) <> 'array'
    or jsonb_array_length(ps.value) <= 2
  );
