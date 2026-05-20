insert into public.staff (
  id,
  name,
  role,
  can_mark_attendance,
  fingerprint_enrolled
)
values (
  'MPESA',
  'M-Pesa Auto',
  'loan_officer',
  false,
  false
)
on conflict (id) do update
set
  name = excluded.name,
  role = excluded.role,
  can_mark_attendance = false,
  fingerprint_enrolled = false;
