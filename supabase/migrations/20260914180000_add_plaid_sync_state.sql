-- Transactions Sync is incremental.  Keep its opaque cursor with the Item;
-- it is not an access token and must never be exposed to clients.
alter table public.plaid_items
  add column if not exists transactions_cursor text;

-- A short lease on the existing single-dataset profile prevents two web
-- requests (or a future scheduled invocation) from processing one dataset at
-- the same time.  The expiry makes a crashed worker recoverable.
alter table public.profiles
  add column if not exists plaid_sync_lock_token uuid,
  add column if not exists plaid_sync_locked_at timestamptz;
