-- Append-only migration. Legacy Items cannot be attributed to personal credentials.
create table public.user_plaid_credentials (
  id uuid primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  environment text not null check (environment in ('sandbox', 'production')),
  encrypted_credentials text not null,
  status text not null default 'active' check (status in ('active', 'revoking')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
alter table public.user_plaid_credentials enable row level security;
revoke all on public.user_plaid_credentials from public, anon, authenticated;
grant all on public.user_plaid_credentials to service_role;

create table public.user_plaid_operations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token uuid not null,
  started_at timestamptz not null default now()
);
alter table public.user_plaid_operations enable row level security;
revoke all on public.user_plaid_operations from public, anon, authenticated;
grant all on public.user_plaid_operations to service_role;

-- Fail closed after a process crash: an administrator must clear abandoned locks.
create function public.acquire_personal_plaid_operation(owner_id uuid, operation_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.user_plaid_operations(user_id, token) values (owner_id, operation_token)
    on conflict (user_id) do nothing;
  return found;
end;
$$;
revoke all on function public.acquire_personal_plaid_operation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.acquire_personal_plaid_operation(uuid, uuid) to service_role;

alter table public.plaid_items
  add column products text[] not null default '{}',
  add column credential_id uuid,
  add column connection_status text not null default 'reconnect_required'
    check (connection_status in ('active', 'reconnect_required', 'revoked')),
  alter column access_token drop not null,
  add constraint plaid_items_credential_owner_fkey foreign key (credential_id, user_id)
    references public.user_plaid_credentials(id, user_id) on delete restrict,
  add constraint plaid_items_active_credentials_check
    check (connection_status <> 'active' or (credential_id is not null and access_token is not null));
create index plaid_items_credential_owner_idx on public.plaid_items(credential_id, user_id);
-- Revoke legacy Items in the former developer Dashboard BEFORE applying this migration.
-- Those Items cannot be safely attributed to a personal credential record.
update public.plaid_items set access_token = null;
alter table public.plaid_items add constraint plaid_items_encrypted_token_check
  check (access_token is null or left(access_token, 3) = 'v1.');

-- Both earlier snapshot migrations kept this NOT NULL, although missing balances
-- are legitimate. Preserve unknown balances as NULL.
alter table public.investment_snapshots alter column portfolio_value drop not null;
