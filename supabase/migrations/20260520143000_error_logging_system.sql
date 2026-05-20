-- Create error_logs table for comprehensive application error tracking
create table error_logs (
  id uuid default gen_random_uuid() primary key,
  timestamp text not null,
  level text not null check (level in ('error', 'warning', 'info')),
  category text not null,
  message text not null,
  file text,
  line integer,
  stack text,
  context jsonb,
  user_id uuid,
  created_at timestamp default now(),
  
  -- For easier querying
  created_date date generated always as (created_at::date) stored
);

-- Indexes for common queries
create index idx_error_logs_created_at on error_logs(created_at desc);
create index idx_error_logs_level on error_logs(level);
create index idx_error_logs_category on error_logs(category);
create index idx_error_logs_user_id on error_logs(user_id);
create index idx_error_logs_created_date on error_logs(created_date desc);

-- Composite index for common filter combinations
create index idx_error_logs_level_created on error_logs(level, created_at desc);
create index idx_error_logs_category_created on error_logs(category, created_at desc);

-- Enable RLS
alter table error_logs enable row level security;

-- Policy: Allow authenticated users to read all error logs
create policy "Allow authenticated users to read error logs"
  on error_logs for select
  using (auth.role() = 'authenticated');

-- Policy: Allow service role to insert error logs
create policy "Allow service role to insert error logs"
  on error_logs for insert
  with check (auth.role() = 'service_role');

-- Policy: Allow service role to delete error logs
create policy "Allow service role to delete error logs"
  on error_logs for delete
  using (auth.role() = 'service_role');

-- Comment on table
comment on table error_logs is 'Stores all application errors, warnings, and info logs for debugging and monitoring';
comment on column error_logs.level is 'Severity level: error, warning, or info';
comment on column error_logs.category is 'Error category for grouping (e.g., "loan_calculation", "payment_processing")';
comment on column error_logs.context is 'Additional context data stored as JSON';
