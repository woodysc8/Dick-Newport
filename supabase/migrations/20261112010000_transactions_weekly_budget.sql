-- Additive only. Review and apply explicitly; do not use db push until history is reconciled.
begin;
alter table public.accounts add column if not exists persistent_account_id text;
alter table public.accounts add column if not exists weekly_budget_source text not null default 'review'
  check (weekly_budget_source in ('review','include','exclude'));
alter table public.transactions add column if not exists plaid_primary_category text;
alter table public.transactions add column if not exists plaid_detailed_category text;
alter table public.transactions add column if not exists plaid_category_confidence text;
alter table public.transactions add column if not exists transaction_currency text;
alter table public.transactions add column if not exists pending_transaction_id text;
alter table public.transactions add column if not exists normalized_category text not null default 'needs_review'
  check (normalized_category in ('dining','coffee','nightlife','groceries','shopping','entertainment','hobbies','personal','other_discretionary','housing','utilities','insurance','debt_payment','card_payment','transfer','investment','savings','tax','income','fixed','needs_review'));
alter table public.transactions add column if not exists category_override text
  check (category_override in ('dining','coffee','nightlife','groceries','shopping','entertainment','hobbies','personal','other_discretionary','housing','utilities','insurance','debt_payment','card_payment','transfer','investment','savings','tax','income','fixed','needs_review'));
alter table public.transactions add column if not exists weekly_budget_override text
  check (weekly_budget_override in ('include','exclude'));
create table if not exists public.user_weekly_budgets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  weekly_limit numeric(12,2) check (weekly_limit >= 0 and weekly_limit <= 100000000),
  timezone text not null default 'America/New_York' check (timezone = 'America/New_York'),
  currency text not null default 'USD' check (currency = 'USD'),
  updated_at timestamptz not null default now()
);
alter table public.user_weekly_budgets enable row level security;
drop policy if exists weekly_budget_owner on public.user_weekly_budgets;
create policy weekly_budget_owner on public.user_weekly_budgets for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on public.user_weekly_budgets from anon;
grant select, insert, update, delete on public.user_weekly_budgets to authenticated;
grant all on public.user_weekly_budgets to service_role;
create index if not exists transactions_owner_category_date_idx on public.transactions(user_id, (coalesce(category_override, normalized_category)), date desc, id desc);
create index if not exists transactions_owner_pending_identity_idx on public.transactions(user_id, account_id, plaid_transaction_id) where pending;
create index if not exists accounts_owner_persistent_idx on public.accounts(user_id, persistent_account_id) where persistent_account_id is not null;

-- Copy only user decisions from the explicitly linked pending predecessor.
-- No merchant/amount/date matching. The sync deletes pending only after saving posted.
create or replace function public.inherit_pending_transaction_preferences() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare predecessor public.transactions%rowtype;
begin
  if new.pending is false and new.pending_transaction_id is not null and new.account_id is not null then
    select * into predecessor from public.transactions
    where user_id=new.user_id and account_id=new.account_id
      and plaid_transaction_id=new.pending_transaction_id and pending=true for update;
    if found then
      new.category_override := coalesce(new.category_override, predecessor.category_override);
      new.weekly_budget_override := coalesce(new.weekly_budget_override, predecessor.weekly_budget_override);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.inherit_pending_transaction_preferences() from public, anon;
drop trigger if exists inherit_pending_preferences on public.transactions;
create trigger inherit_pending_preferences before insert on public.transactions
  for each row execute function public.inherit_pending_transaction_preferences();

-- One statement snapshot avoids drifting offsets and mixed settings/account/transaction
-- versions during concurrent imports. Bounds apply even to direct authenticated calls.
create or replace function public.weekly_budget_snapshot(start_date date, end_date date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t)) from (
      select id, account_id, plaid_transaction_id, date, name, merchant_name, amount,
        pending, category, normalized_category, category_override, weekly_budget_override,
        transaction_currency, pending_transaction_id, plaid_primary_category,
        plaid_detailed_category, plaid_category_confidence
      from public.transactions where user_id=(select auth.uid())
        and date >= start_date and date < end_date order by id limit 10001
    ) t), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(to_jsonb(a)) from (
      select id, account_name, institution_name, currency, persistent_account_id,
        weekly_budget_source, created_at from public.accounts
      where user_id=(select auth.uid()) order by id limit 501
    ) a), '[]'::jsonb),
    'weekly_limit', (select weekly_limit from public.user_weekly_budgets where user_id=(select auth.uid())),
    'sync_in_progress', coalesce((select plaid_sync_lock_token is not null
      and plaid_sync_locked_at > now() - interval '15 minutes'
      from public.profiles where id=(select auth.uid())), false)
  ) where (select auth.uid()) is not null and end_date > start_date and end_date - start_date <= 14;
$$;
revoke all on function public.weekly_budget_snapshot(date,date) from public, anon;
grant execute on function public.weekly_budget_snapshot(date,date) to authenticated;
commit;
