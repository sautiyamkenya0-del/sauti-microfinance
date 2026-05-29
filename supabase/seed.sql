-- Seed legacy members first, then confirmed M-Pesa receipts.
-- The receipts stay unprocessed in public.mpesa_events so the app allocator
-- distributes them through the same waterfall used by live Daraja callbacks.

\ir seeds/client_list.sql
\ir seeds/api_topups_1.sql
\ir seeds/api_topups_2.sql
\ir seeds/api_topups_3.sql
\ir seeds/api_topups_4.sql
\ir seeds/api_topups_5.sql
\ir seeds/api_topups_6.sql
\ir seeds/api_topups_7.sql
\ir seeds/api_topups_8.sql
\ir seeds/lead_way_fuel.sql
