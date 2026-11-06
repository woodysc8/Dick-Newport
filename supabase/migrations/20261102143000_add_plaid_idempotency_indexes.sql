-- Protect repeatable Plaid synchronization from duplicate account and
-- transaction rows. Run the duplicate-detection queries below before applying
-- this migration; either index will fail if existing duplicates are present.
create unique index accounts_plaid_identity_key
  on public.accounts (user_id, plaid_item_id, plaid_account_id)
  where plaid_item_id is not null and plaid_account_id is not null;

create unique index transactions_plaid_identity_key
  on public.transactions (user_id, plaid_transaction_id)
  where plaid_transaction_id is not null;
