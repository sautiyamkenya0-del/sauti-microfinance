-- Seed legacy members first, then confirmed M-Pesa receipts.
-- The receipts stay unprocessed in public.mpesa_events so the app allocator
-- distributes them through the same waterfall used by live Daraja callbacks.

\ir seeds/client_list.sql
\ir seeds/api_topups.sql
