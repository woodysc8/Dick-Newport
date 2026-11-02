-- Preserve existing account-balance snapshots and add an explicit
-- securities-only value for future portfolio-growth observations.
alter table public.investment_snapshots
  add column if not exists securities_value numeric;