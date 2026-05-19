do $$
begin
  alter type public.tx_type add value if not exists 'mpesa_unallocated';
exception
  when duplicate_object then null;
end $$;
