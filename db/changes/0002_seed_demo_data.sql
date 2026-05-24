-- =====================================================================
-- Sauti Microfinance — Demo seed data
-- =====================================================================
-- Run this after applying the initial schema.
-- This file seeds the demo staff, members, loans, transactions,
-- penalties, round-off entries, petty cash, investor records, and
-- attendance data used by the app's sample dataset.
-- =====================================================================

-- Staff
insert into public.staff (id, name, role, email, phone, temp_password, can_mark_attendance)
values
  ('S1', 'System Admin', 'director', 'admin@sauti.co.ke', null, 'Sauti1234', true),
  ('S2', 'Grace Wanjiku', 'manager', 'grace@sauti.co.ke', '+254722000002', 'Sauti1234', true),
  ('S3', 'Peter Otieno', 'loan_officer', 'peter@sauti.co.ke', '+254722000003', 'Sauti1234', false),
  ('S4', 'Mary Achieng', 'loan_officer', 'mary@sauti.co.ke', '+254722000004', 'Sauti1234', false)
on conflict (id) do nothing;

-- Investors
insert into public.investors (
  id, name, contributed, share_pct, joined_at, phone, member_id, notes
)
values
  ('I1', 'Beatrice Mutiso', 100000, 60, current_date - interval '90 days', '+254722000108', null, 'Founding investor'),
  ('I2', 'Daniel Mbugua', 75000, 40, current_date - interval '60 days', '+254722000999', null, 'External investor')
on conflict (id) do nothing;

-- Members
insert into public.members (
  id, name, phone, joined_at, status, shares, savings_balance,
  fee_membership, fee_card, fee_has_shop, fee_sticker, fee_first_upfront_paid,
  is_investor, investor_id,
  first_name, last_name, gender, county, village, business_name, business_type,
  field_officer_id
)
values
  ('M101', 'John Kamau', '+254722000101', current_date - interval '120 days', 'active', 10, 8500,
    true, true, true, true, true, false, null,
    'John', 'Kamau', 'Male', 'Nairobi', 'Kawangware', 'Kamau Hardware', 'Retail', 'S3'),
  ('M102', 'Jane Njeri', '+254722000102', current_date - interval '95 days', 'active', 6, 5200,
    true, true, true, true, true, false, null,
    'Jane', 'Njeri', 'Female', 'Kiambu', 'Ruiru', 'Njeri Salon', 'Services', 'S3'),
  ('M103', 'Samuel Mwangi', '+254722000103', current_date - interval '80 days', 'active', 4, 3000,
    true, true, true, true, true, false, null,
    'Samuel', 'Mwangi', 'Male', 'Nakuru', 'Naka', 'Mwangi Boda', 'Transport', 'S4'),
  ('M104', 'Esther Wambui', '+254722000104', current_date - interval '70 days', 'active', 8, 6800,
    true, true, true, true, true, false, null,
    'Esther', 'Wambui', 'Female', 'Nyeri', 'Ruring''u', 'Wambui Greens', 'Mama Mboga', 'S4'),
  ('M105', 'Daniel Ouma', '+254722000105', current_date - interval '55 days', 'active', 5, 4100,
    true, true, true, true, true, false, null,
    'Daniel', 'Ouma', 'Male', 'Kisumu', 'Kondele', 'Ouma Electronics', 'Retail', 'S3'),
  ('M106', 'Lucy Akinyi', '+254722000106', current_date - interval '40 days', 'active', 3, 2400,
    true, true, true, true, true, false, null,
    'Lucy', 'Akinyi', 'Female', 'Mombasa', 'Likoni', 'Akinyi Tailoring', 'Services', 'S4'),
  ('M107', 'Patrick Kiprono', '+254722000107', current_date - interval '25 days', 'active', 2, 1500,
    true, true, true, true, false, false, null,
    'Patrick', 'Kiprono', 'Male', 'Eldoret', 'Langas', 'Kiprono Cyber', 'Services', 'S3'),
  ('M108', 'Beatrice Mutiso', '+254722000108', current_date - interval '10 days', 'active', 12, 12000,
    true, true, true, true, true, true, 'I1',
    'Beatrice', 'Mutiso', 'Female', 'Machakos', 'Athi River', 'Mutiso Wholesalers', 'Wholesale', 'S4')
on conflict (id) do nothing;

update public.investors
set member_id = 'M108'
where id = 'I1';

-- Loans
insert into public.loans (
  id, member_id, principal, approved_amount, rate, term_months, term_days,
  start_date, status, officer_id, paid, purpose, reviewed_by
)
values
  ('L1001', 'M101', 20000, 20000, 20, 1, 30, current_date - interval '60 days', 'active', 'S3', 12000, 'Stock purchase', 'S2'),
  ('L1002', 'M102', 10000, 10000, 15, 1, 14, current_date - interval '40 days', 'closed', 'S3', 11500, 'Salon supplies', 'S2'),
  ('L1003', 'M103', 15000, 15000, 20, 1, 30, current_date - interval '35 days', 'active', 'S4', 5000, 'Boda spares', 'S2'),
  ('L1004', 'M104', 8000, 8000, 10, 1, 7, current_date - interval '20 days', 'defaulted', 'S4', 2000, 'Restocking', 'S2'),
  ('L1005', 'M105', 25000, 0, 20, 1, 30, current_date, 'pending', 'S3', 0, 'Expansion', null),
  ('L1006', 'M108', 30000, 30000, 20, 1, 30, current_date - interval '15 days', 'active', 'S4', 10000, 'Wholesale stock', 'S2')
on conflict (id) do nothing;

-- Transactions
insert into public.transactions (
  id, date, type, amount, member_id, loan_id, ref, by_staff, note
)
values
  ('T1', current_date - interval '60 days', 'loan_disbursement', 20000, 'M101', 'L1001', 'DISB-1001', 'S3', null),
  ('T2', current_date - interval '45 days', 'loan_repayment', 6000, 'M101', 'L1001', 'MPESA-RA1', 'S3', null),
  ('T3', current_date - interval '25 days', 'loan_repayment', 6000, 'M101', 'L1001', 'MPESA-RA2', 'S3', null),
  ('T4', current_date - interval '40 days', 'loan_disbursement', 10000, 'M102', 'L1002', 'DISB-1002', 'S3', null),
  ('T5', current_date - interval '20 days', 'loan_repayment', 11000, 'M102', 'L1002', 'MPESA-RB1', 'S3', null),
  ('T6', current_date - interval '35 days', 'loan_disbursement', 15000, 'M103', 'L1003', 'DISB-1003', 'S4', null),
  ('T7', current_date - interval '10 days', 'loan_repayment', 5000, 'M103', 'L1003', 'MPESA-RC1', 'S4', null),
  ('T8', current_date - interval '20 days', 'loan_disbursement', 8000, 'M104', 'L1004', 'DISB-1004', 'S4', null),
  ('T9', current_date - interval '12 days', 'loan_repayment', 2000, 'M104', 'L1004', 'MPESA-RD1', 'S4', null),
  ('T10', current_date - interval '15 days', 'loan_disbursement', 30000, 'M108', 'L1006', 'DISB-1006', 'S4', null),
  ('T11', current_date - interval '5 days', 'loan_repayment', 10000, 'M108', 'L1006', 'MPESA-RE1', 'S4', null),
  ('T12', current_date - interval '80 days', 'deposit', 5000, 'M101', null, null, 'S3', 'Daily compliance contribution'),
  ('T13', current_date - interval '60 days', 'deposit', 3500, 'M102', null, null, 'S3', 'Daily compliance contribution'),
  ('T14', current_date - interval '50 days', 'share_purchase', 5000, 'M101', null, null, 'S3', '10 shares'),
  ('T15', current_date - interval '70 days', 'share_purchase', 6000, 'M108', null, null, 'S4', '12 shares'),
  ('T16', current_date - interval '30 days', 'fee_payment', 1000, 'M106', null, null, 'S4', 'Membership + card'),
  ('T17', current_date - interval '8 days', 'investor_contribution', 50000, 'M108', null, 'INV-I1', 'S2', 'Investor I1 top-up'),
  ('T18', current_date - interval '3 days', 'petty_cash', 1500, null, null, null, 'S2', 'Office supplies')
on conflict (id) do nothing;

-- Penalties
insert into public.penalties (
  id, member_id, loan_id, date, amount, reason, status, paid_from
)
values
  ('P1', 'M104', 'L1004', current_date - interval '8 days', 500, 'Late repayment', 'outstanding', null),
  ('P2', 'M101', 'L1001', current_date - interval '20 days', 200, 'Missed installment', 'paid', 'round_off_pool')
on conflict (id) do nothing;

-- Round-off entries
insert into public.round_off (
  id, member_id, date, amount, source, ref
)
values
  ('R1', 'M101', current_date - interval '45 days', 4, 'loan_repayment', 'MPESA-RA1'),
  ('R2', 'M108', current_date - interval '5 days', 3, 'loan_repayment', 'MPESA-RE1')
on conflict (id) do nothing;

-- Petty cash
insert into public.petty_cash (
  id, date, description, amount, category, by_staff, type, mode, opening_balance, payee
)
values
  ('PC1', current_date - interval '20 days', 'Topup from bank', 20000, 'topup', 'S2', 'topup', 'bank', 0, null),
  ('PC2', current_date - interval '15 days', 'Airtime', 500, 'office', 'S2', 'payment', 'cash', null, 'Safaricom'),
  ('PC3', current_date - interval '7 days', 'Office tea', 350, 'office', 'S2', 'payment', 'cash', null, 'Local shop'),
  ('PC4', current_date - interval '3 days', 'Office supplies', 1500, 'office', 'S2', 'payment', 'cash', null, 'Stationers')
on conflict (id) do nothing;

-- Attendance
insert into public.attendance (
  id, staff_id, date, status, check_in, check_out
)
values
  ('A1', 'S2', current_date - interval '2 days', 'present', '08:05', '17:10'),
  ('A2', 'S3', current_date - interval '2 days', 'present', '08:15', '17:00'),
  ('A3', 'S4', current_date - interval '2 days', 'late', '09:20', '17:05'),
  ('A4', 'S2', current_date - interval '1 day', 'present', '08:00', '17:00'),
  ('A5', 'S3', current_date - interval '1 day', 'present', '08:10', '17:00'),
  ('A6', 'S4', current_date - interval '1 day', 'absent', null, null),
  ('A7', 'S2', current_date, 'present', '08:02', null),
  ('A8', 'S3', current_date, 'present', '08:20', null)
on conflict (id) do nothing;

-- Notes
-- Watchdog analysis and runtime secret storage require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
-- to be present in your server environment. Add them to local .env or hosting secrets.
