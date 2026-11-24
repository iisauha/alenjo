-- A posted transaction your bank withdraws is set aside for review instead of being deleted.
-- sync-transactions sets removed_at when Plaid removes a posted transaction; pending ones are still deleted.
alter table public.synced_transactions add column if not exists removed_at timestamptz;
