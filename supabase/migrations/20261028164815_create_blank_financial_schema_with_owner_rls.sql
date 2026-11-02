
-- Fresh, data-free schema for Dick Newport development.
-- Intentionally does not copy Richard Newport's rows, Plaid credentials, or auth users.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  full_name text,
  plaid_sync_locked_at timestamptz,
  plaid_sync_lock_token uuid,
  financial_profile jsonb
);

create table public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plaid_item_id text not null unique,
  access_token text not null,
  institution_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  transactions_cursor text
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  institution_name text not null,
  account_name text not null,
  account_type text,
  account_subtype text,
  mask text,
  plaid_item_id text,
  plaid_account_id text,
  current_balance numeric,
  available_balance numeric,
  currency text default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounts_id_user_id_key unique (id, user_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  account_id uuid,
  plaid_transaction_id text,
  date date not null,
  name text not null,
  merchant_name text,
  amount numeric not null,
  category text,
  pending boolean default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_account_owner_fkey
    foreign key (account_id, user_id) references public.accounts(id, user_id) on delete cascade
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  monthly_limit numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.financial_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  target_amount numeric,
  current_amount numeric default 0,
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.financial_settings (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  monthly_income numeric,
  emergency_fund_target numeric,
  minimum_cash_buffer numeric,
  retirement_contribution_percent numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.investment_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plaid_item_id text,
  plaid_account_id text,
  security_id text,
  ticker_symbol text,
  security_name text,
  quantity numeric,
  institution_price numeric,
  institution_value numeric,
  cost_basis numeric,
  currency text default 'USD',
  iso_currency_code text,
  updated_at timestamptz default now(),
  constraint investment_holdings_user_account_security_key
    unique (user_id, plaid_account_id, security_id)
);

create table public.investment_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plaid_item_id text not null,
  plaid_account_id text not null,
  snapshot_date date not null,
  portfolio_value numeric not null,
  created_at timestamptz not null default now(),
  securities_value numeric,
  constraint investment_snapshots_user_account_date_key
    unique (user_id, plaid_account_id, snapshot_date)
);

create index accounts_user_id_idx on public.accounts(user_id);
create index transactions_user_id_date_idx on public.transactions(user_id, date desc);
create index transactions_account_owner_idx on public.transactions(account_id, user_id);
create index budgets_user_id_idx on public.budgets(user_id);
create index financial_goals_user_id_idx on public.financial_goals(user_id);
create index plaid_items_user_id_idx on public.plaid_items(user_id);
create index investment_holdings_user_id_idx on public.investment_holdings(user_id);
create index investment_snapshots_lookup_idx on public.investment_snapshots(user_id, plaid_account_id, snapshot_date desc);

alter table public.profiles enable row level security;
alter table public.plaid_items enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.financial_goals enable row level security;
alter table public.financial_settings enable row level security;
alter table public.investment_holdings enable row level security;
alter table public.investment_snapshots enable row level security;

create policy "profile_select_own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profile_insert_own" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "profile_update_own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "accounts_manage_own" on public.accounts
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "transactions_manage_own" on public.transactions
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "budgets_manage_own" on public.budgets
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "financial_goals_manage_own" on public.financial_goals
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "financial_settings_manage_own" on public.financial_settings
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "investment_holdings_manage_own" on public.investment_holdings
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "investment_snapshots_manage_own" on public.investment_snapshots
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Plaid access tokens must remain server-only. No authenticated-client policies are
-- created for plaid_items; authenticated app routes must authorize requests server-side.
revoke all on public.plaid_items from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.accounts, public.transactions,
  public.budgets, public.financial_goals, public.financial_settings,
  public.investment_holdings, public.investment_snapshots to authenticated;

