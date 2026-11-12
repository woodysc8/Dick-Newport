-- Local-only implementation approved. Do not apply without separate approval.
alter table public.accounts
  add column holdings_status text not null default 'not_synced'
    check (holdings_status in ('not_synced','ready','empty','unsupported','permission_required','not_ready','not_returned','error')),
  add column holdings_synced_at timestamptz;

create function public.import_investment_holdings(owner_id uuid, connection_id uuid, expected_credential_id uuid, payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved_item public.plaid_items%rowtype;
  import_account jsonb;
  import_holding jsonb;
  observed_at timestamptz := clock_timestamp();
  account_count integer;
  holding_count integer;
begin
  select i.* into saved_item from public.plaid_items i
    join public.user_plaid_credentials c on c.id=i.credential_id and c.user_id=i.user_id and c.status='active'
    where i.id=connection_id and i.user_id=owner_id and i.credential_id=expected_credential_id and i.connection_status='active'
    for update of i;
  if not found then raise exception 'Connection ownership or credentials unavailable' using errcode='42501'; end if;
  if jsonb_typeof(payload->'accounts') is distinct from 'array' or jsonb_typeof(payload->'holdings') is distinct from 'array'
    or jsonb_array_length(payload->'accounts') not between 1 and 500 or jsonb_array_length(payload->'holdings') > 10000 then
    raise exception 'Incomplete holdings payload';
  end if;
  if exists (select 1 from jsonb_array_elements(payload->'accounts') x where nullif(x->>'account_id','') is null or x->>'type' is distinct from 'investment')
    or exists (select 1 from jsonb_array_elements(payload->'accounts') x group by x->>'account_id' having count(*)>1)
    or exists (select 1 from jsonb_array_elements(payload->'holdings') x where nullif(x->>'security_id','') is null or not exists
      (select 1 from jsonb_array_elements(payload->'accounts') a where a->>'account_id'=x->>'account_id'))
    or exists (select 1 from jsonb_array_elements(payload->'holdings') x group by x->>'account_id',x->>'security_id' having count(*)>1) then
    raise exception 'Invalid account or position identities';
  end if;
  if exists (select 1 from public.accounts a join jsonb_array_elements(payload->'accounts') x on a.plaid_account_id=x->>'account_id'
    where a.user_id<>owner_id or a.plaid_item_id is distinct from saved_item.plaid_item_id)
    or exists (select 1 from public.investment_holdings h join jsonb_array_elements(payload->'accounts') x on h.plaid_account_id=x->>'account_id'
    where h.user_id<>owner_id or h.plaid_item_id is distinct from saved_item.plaid_item_id) then
    raise exception 'Account isolation check failed' using errcode='42501';
  end if;
  for import_account in select * from jsonb_array_elements(payload->'accounts') loop
    insert into public.accounts(user_id,plaid_item_id,plaid_account_id,institution_name,account_name,account_type,account_subtype,mask,current_balance,available_balance,currency,persistent_account_id,updated_at,holdings_status,holdings_synced_at)
    values(owner_id,saved_item.plaid_item_id,import_account->>'account_id',coalesce(saved_item.institution_name,'Institution unverified'),coalesce(import_account->>'name','Investment account'),'investment',import_account->>'subtype',import_account->>'mask',(import_account->>'current_balance')::numeric,(import_account->>'available_balance')::numeric,import_account->>'currency',import_account->>'persistent_account_id',observed_at,
      case when exists(select 1 from jsonb_array_elements(payload->'holdings') h where h->>'account_id'=import_account->>'account_id') then 'ready' else 'empty' end,observed_at)
    on conflict(user_id,plaid_item_id,plaid_account_id) where plaid_item_id is not null and plaid_account_id is not null do update
    set institution_name=excluded.institution_name,account_name=excluded.account_name,account_type=excluded.account_type,account_subtype=excluded.account_subtype,
      mask=excluded.mask,current_balance=excluded.current_balance,available_balance=excluded.available_balance,currency=excluded.currency,
      persistent_account_id=coalesce(excluded.persistent_account_id,public.accounts.persistent_account_id),updated_at=excluded.updated_at,
      holdings_status=excluded.holdings_status,holdings_synced_at=excluded.holdings_synced_at;
  end loop;
  for import_holding in select * from jsonb_array_elements(payload->'holdings') loop
    insert into public.investment_holdings(user_id,plaid_item_id,plaid_account_id,security_id,security_name,ticker_symbol,quantity,institution_price,institution_value,cost_basis,currency,iso_currency_code,updated_at)
    values(owner_id,saved_item.plaid_item_id,import_holding->>'account_id',import_holding->>'security_id',import_holding->>'security_name',import_holding->>'ticker_symbol',(import_holding->>'quantity')::numeric,(import_holding->>'institution_price')::numeric,(import_holding->>'institution_value')::numeric,(import_holding->>'cost_basis')::numeric,import_holding->>'currency',import_holding->>'currency',observed_at)
    on conflict(user_id,plaid_account_id,security_id) do update set security_name=excluded.security_name,ticker_symbol=excluded.ticker_symbol,
      quantity=excluded.quantity,institution_price=excluded.institution_price,institution_value=excluded.institution_value,cost_basis=excluded.cost_basis,
      currency=excluded.currency,iso_currency_code=excluded.iso_currency_code,updated_at=excluded.updated_at;
  end loop;
  -- Absence is authoritative only inside explicitly returned accounts. The
  -- entire function is one transaction: any later failure restores old rows.
  delete from public.investment_holdings h where h.user_id=owner_id and h.plaid_item_id=saved_item.plaid_item_id
    and exists(select 1 from jsonb_array_elements(payload->'accounts') a where a->>'account_id'=h.plaid_account_id)
    and not exists(select 1 from jsonb_array_elements(payload->'holdings') x where x->>'account_id'=h.plaid_account_id and x->>'security_id'=h.security_id);
  update public.accounts a set holdings_status='not_returned' where a.user_id=owner_id and a.plaid_item_id=saved_item.plaid_item_id
    and a.account_type in ('investment','crypto','retirement') and not exists(select 1 from jsonb_array_elements(payload->'accounts') x where x->>'account_id'=a.plaid_account_id);
  account_count := jsonb_array_length(payload->'accounts'); holding_count := jsonb_array_length(payload->'holdings');
  return jsonb_build_object('accounts',account_count,'holdings',holding_count,'synced_at',observed_at);
end;
$$;
revoke all on function public.import_investment_holdings(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_investment_holdings(uuid,uuid,uuid,jsonb) to service_role;
