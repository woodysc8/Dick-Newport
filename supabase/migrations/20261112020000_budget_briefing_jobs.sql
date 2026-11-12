-- Pending explicit approval. No backfill, budget-value updates, credential changes or live jobs.
begin;
alter table public.transactions add column if not exists monthly_budget_override text check (monthly_budget_override in ('include','exclude'));
alter table public.transactions drop constraint if exists transactions_normalized_category_check;
alter table public.transactions drop constraint if exists transactions_category_override_check;
alter table public.transactions add constraint transactions_normalized_category_check check (normalized_category in ('dining','coffee','nightlife','groceries','shopping','entertainment','hobbies','personal','other_discretionary','housing','utilities','insurance','debt_payment','card_payment','transfer','investment','savings','tax','income','fixed','needs_review','gas','household','personal_care','healthcare','subscriptions'));
alter table public.transactions add constraint transactions_category_override_check check (category_override in ('dining','coffee','nightlife','groceries','shopping','entertainment','hobbies','personal','other_discretionary','housing','utilities','insurance','debt_payment','card_payment','transfer','investment','savings','tax','income','fixed','needs_review','gas','household','personal_care','healthcare','subscriptions'));

create table if not exists public.budget_category_rules (
 user_id uuid not null references public.profiles(id) on delete cascade,
 category text not null check (category in ('dining','coffee','nightlife','groceries','shopping','entertainment','hobbies','personal','other_discretionary','housing','utilities','insurance','debt_payment','card_payment','transfer','investment','savings','tax','income','fixed','needs_review','gas','household','personal_care','healthcare','subscriptions')),
 weekly_included boolean, monthly_included boolean,
 monthly_group text check(monthly_group in ('fixed','essential','discretionary','excluded')),
 weekly_cap numeric(12,2) check(weekly_cap between 0 and 100000000),
 monthly_cap numeric(12,2) check(monthly_cap between 0 and 100000000),
 primary key(user_id,category)
);
create table if not exists public.budget_account_rules (
 user_id uuid not null references public.profiles(id) on delete cascade,
 account_id uuid not null,
 weekly_included boolean, monthly_included boolean,
 primary key(user_id,account_id),
 foreign key(account_id,user_id) references public.accounts(id,user_id) on delete cascade
);
create table if not exists public.user_monthly_budgets (
 user_id uuid primary key references public.profiles(id) on delete cascade,
 monthly_limit numeric(12,2) check(monthly_limit between 0 and 100000000),
 currency text not null default 'USD' check(currency='USD'),
 timezone text not null default 'America/New_York' check(timezone='America/New_York')
);
create table if not exists public.budget_audit (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 entity text not null, record_id text not null, before_value jsonb, after_value jsonb,
 created_at timestamptz not null default now()
);
alter table public.budget_category_rules enable row level security;
alter table public.budget_account_rules enable row level security;
alter table public.user_monthly_budgets enable row level security;
alter table public.budget_audit enable row level security;
drop policy if exists category_rule_owner on public.budget_category_rules;
create policy category_rule_owner on public.budget_category_rules for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
drop policy if exists account_rule_owner on public.budget_account_rules;
create policy account_rule_owner on public.budget_account_rules for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
drop policy if exists monthly_budget_owner on public.user_monthly_budgets;
create policy monthly_budget_owner on public.user_monthly_budgets for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
drop policy if exists budget_audit_read on public.budget_audit;
create policy budget_audit_read on public.budget_audit for select to authenticated using((select auth.uid())=user_id);
drop policy if exists budget_audit_insert on public.budget_audit;
create policy budget_audit_insert on public.budget_audit for insert to authenticated with check((select auth.uid())=user_id);
revoke all on public.budget_category_rules,public.budget_account_rules,public.user_monthly_budgets,public.budget_audit from anon;
grant select,insert,update,delete on public.budget_category_rules,public.budget_account_rules,public.user_monthly_budgets to authenticated;
grant select,insert on public.budget_audit to authenticated;
grant all on public.budget_category_rules,public.budget_account_rules,public.user_monthly_budgets,public.budget_audit to service_role;
create index if not exists budget_audit_owner_created on public.budget_audit(user_id,created_at desc);

-- Invoker audit: grants and RLS remain the authority. Only user-controlled preferences
-- are recorded; provider names, amounts, descriptions, tokens and credentials are absent.
create or replace function public.audit_budget_preferences() returns trigger language plpgsql security invoker set search_path='' as $$
declare before_json jsonb; after_json jsonb; owner_id uuid; record_key text;
begin
 if tg_table_name='transactions' then
  before_json:=case when tg_op='UPDATE' then jsonb_build_object('category_override',old.category_override,'weekly_budget_override',old.weekly_budget_override,'monthly_budget_override',old.monthly_budget_override) else null end;
  after_json:=jsonb_build_object('category_override',new.category_override,'weekly_budget_override',new.weekly_budget_override,'monthly_budget_override',new.monthly_budget_override);
  owner_id:=new.user_id; record_key:=new.id::text;
 elsif tg_table_name='accounts' then
  before_json:=jsonb_build_object('source',old.weekly_budget_source);
  after_json:=jsonb_build_object('source',new.weekly_budget_source);
  owner_id:=new.user_id; record_key:=new.id::text;
 else
  before_json:=case when tg_op='UPDATE' then to_jsonb(old)-'user_id' else null end;
  after_json:=to_jsonb(new)-'user_id'; owner_id:=new.user_id;
  record_key:=coalesce(after_json->>'category',after_json->>'account_id',owner_id::text);
 end if;
 if before_json is distinct from after_json then
  insert into public.budget_audit(user_id,entity,record_id,before_value,after_value) values(owner_id,tg_table_name,record_key,before_json,after_json);
 end if;
 return new;
end $$;
revoke all on function public.audit_budget_preferences() from public,anon;
drop trigger if exists audit_transaction_preferences on public.transactions;
create trigger audit_transaction_preferences after update of category_override,weekly_budget_override,monthly_budget_override on public.transactions for each row execute function public.audit_budget_preferences();
drop trigger if exists audit_category_preferences on public.budget_category_rules;
create trigger audit_category_preferences after insert or update on public.budget_category_rules for each row execute function public.audit_budget_preferences();
drop trigger if exists audit_account_preferences on public.budget_account_rules;
create trigger audit_account_preferences after insert or update on public.budget_account_rules for each row execute function public.audit_budget_preferences();
drop trigger if exists audit_monthly_preferences on public.user_monthly_budgets;
create trigger audit_monthly_preferences after insert or update on public.user_monthly_budgets for each row execute function public.audit_budget_preferences();
drop trigger if exists audit_weekly_preferences on public.user_weekly_budgets;
create trigger audit_weekly_preferences after insert or update on public.user_weekly_budgets for each row execute function public.audit_budget_preferences();
drop trigger if exists audit_source_preferences on public.accounts;
create trigger audit_source_preferences after update of weekly_budget_source on public.accounts for each row execute function public.audit_budget_preferences();

create or replace function public.inherit_pending_transaction_preferences() returns trigger language plpgsql security invoker set search_path='' as $$
declare predecessor public.transactions%rowtype;
begin
 if new.pending is false and new.pending_transaction_id is not null and new.account_id is not null then
  select * into predecessor from public.transactions where user_id=new.user_id and account_id=new.account_id and plaid_transaction_id=new.pending_transaction_id and pending=true for update;
  if found then
   new.category_override:=coalesce(new.category_override,predecessor.category_override);
   new.weekly_budget_override:=coalesce(new.weekly_budget_override,predecessor.weekly_budget_override);
   new.monthly_budget_override:=coalesce(new.monthly_budget_override,predecessor.monthly_budget_override);
  end if;
 end if;
 return new;
end $$;

create or replace function public.review_budget_transactions(ids uuid[], category text, weekly text, monthly text) returns integer language plpgsql security invoker set search_path='' as $$
declare count_found integer;
begin
 if auth.uid() is null or ids is null or cardinality(ids) not between 1 and 50 or category is null or weekly is null or monthly is null or weekly not in ('include','exclude','default') or monthly not in ('include','exclude','default') then raise exception 'Invalid review'; end if;
 perform id from public.transactions where user_id=auth.uid() and id=any(ids) order by id for update;
 select count(*) into count_found from public.transactions where user_id=auth.uid() and id=any(ids);
 if count_found <> cardinality(ids) then raise exception 'Review ownership mismatch'; end if;
 update public.transactions set category_override=review_budget_transactions.category,weekly_budget_override=nullif(weekly,'default'),monthly_budget_override=nullif(monthly,'default') where user_id=auth.uid() and id=any(ids);
 return count_found;
end $$;
revoke all on function public.review_budget_transactions(uuid[],text,text,text) from public,anon;
grant execute on function public.review_budget_transactions(uuid[],text,text,text) to authenticated;

-- Private durable jobs. Browser callers can only read a separate safe status table.
create table if not exists public.financial_job_runs (
 user_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('sync','briefing')), job_key text not null check(length(job_key)<=160),
 token uuid not null, state text not null check(state in ('running','succeeded','failed')),
 attempts integer not null default 1 check(attempts between 1 and 3),
 lease_until timestamptz not null, started_at timestamptz not null default now(),
 primary key(user_id,kind,job_key)
);
create table if not exists public.financial_job_status (
 user_id uuid not null references public.profiles(id) on delete cascade,
 kind text not null check(kind in ('sync','briefing')),
 last_attempt_at timestamptz, last_success_at timestamptz,
 last_error text check(last_error in ('CONFIGURATION','UNAVAILABLE','PROVIDER_REJECTED','STALE_PREVIEW')),
 primary key(user_id,kind)
);
alter table public.financial_job_runs enable row level security;
alter table public.financial_job_status enable row level security;
drop policy if exists financial_status_owner on public.financial_job_status;
create policy financial_status_owner on public.financial_job_status for select to authenticated using((select auth.uid())=user_id);
revoke all on public.financial_job_runs,public.financial_job_status from anon,authenticated;
grant select on public.financial_job_status to authenticated;
grant all on public.financial_job_runs,public.financial_job_status to service_role;
create index if not exists financial_job_owner_kind_started on public.financial_job_runs(user_id,kind,started_at desc);
create or replace function public.claim_financial_job(owner_id uuid,job_kind text,key text,lease_token uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare previous public.financial_job_runs%rowtype;
begin
 if job_kind not in ('sync','briefing') or length(key)>160 then return false; end if;
 -- Serialize claims across keys and instances; no security-definer authority.
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text||job_kind,0));
 if exists(select 1 from public.financial_job_runs where user_id=owner_id and kind=job_kind and state='running' and lease_until>now()) then return false; end if;
 select * into previous from public.financial_job_runs where user_id=owner_id and kind=job_kind and job_key=key;
 if found and (previous.state='succeeded' or previous.attempts>=3) then return false; end if;
 if job_kind='sync' and (select coalesce(sum(attempts),0) from public.financial_job_runs where user_id=owner_id and kind='sync' and (started_at at time zone 'America/New_York')::date=(now() at time zone 'America/New_York')::date)>=4 then return false; end if;
 if exists(select 1 from public.financial_job_status where user_id=owner_id and kind=job_kind and last_attempt_at>now()-interval '15 minutes') then return false; end if;
 insert into public.financial_job_runs(user_id,kind,job_key,token,state,lease_until) values(owner_id,job_kind,key,lease_token,'running',now()+interval '15 minutes')
 on conflict(user_id,kind,job_key) do update set token=excluded.token,state='running',lease_until=excluded.lease_until,started_at=now(),attempts=financial_job_runs.attempts+1;
 insert into public.financial_job_status(user_id,kind,last_attempt_at) values(owner_id,job_kind,now()) on conflict(user_id,kind) do update set last_attempt_at=now();
 return true;
end $$;
create or replace function public.finish_financial_job(owner_id uuid,job_kind text,key text,lease_token uuid,succeeded boolean,error_category text) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.financial_job_runs set state=case when succeeded then 'succeeded' else 'failed' end,lease_until=now() where user_id=owner_id and kind=job_kind and job_key=key and token=lease_token and state='running';
 if not found then return false; end if;
 update public.financial_job_status set last_success_at=case when succeeded then now() else last_success_at end,last_error=case when succeeded then null else error_category end where user_id=owner_id and kind=job_kind;
 return true;
end $$;
revoke all on function public.claim_financial_job(uuid,text,text,uuid),public.finish_financial_job(uuid,text,text,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_financial_job(uuid,text,text,uuid),public.finish_financial_job(uuid,text,text,uuid,boolean,text) to service_role;

create or replace function public.financial_budget_snapshot(start_date date,end_date date) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'user_id',auth.uid(),
 'planning_profile',(select financial_profile from public.profiles where id=auth.uid()),
 'transactions',coalesce((select jsonb_agg(to_jsonb(t)) from (select id,account_id,plaid_transaction_id,date,name,merchant_name,amount,pending,category,normalized_category,category_override,weekly_budget_override,monthly_budget_override,transaction_currency,pending_transaction_id,plaid_primary_category,plaid_detailed_category,plaid_category_confidence from public.transactions where user_id=auth.uid() and date>=start_date and date<end_date order by id limit 10001)t),'[]'::jsonb),
 'accounts',coalesce((select jsonb_agg(to_jsonb(a)) from(select id,account_name,institution_name,currency,persistent_account_id,weekly_budget_source,created_at,account_type,current_balance from public.accounts where user_id=auth.uid() order by id limit 501)a),'[]'::jsonb),
 'weekly_limit',(select weekly_limit from public.user_weekly_budgets where user_id=auth.uid()),
 'monthly_limit',(select monthly_limit from public.user_monthly_budgets where user_id=auth.uid()),
 'category_rules',coalesce((select jsonb_agg(to_jsonb(r)-'user_id') from public.budget_category_rules r where user_id=auth.uid()),'[]'::jsonb),
 'account_rules',coalesce((select jsonb_agg(to_jsonb(r)-'user_id') from public.budget_account_rules r where user_id=auth.uid()),'[]'::jsonb),
 'jobs',coalesce((select jsonb_agg(to_jsonb(j)-'user_id') from public.financial_job_status j where user_id=auth.uid()),'[]'::jsonb),
 'sync_in_progress',coalesce((select plaid_sync_lock_token is not null and plaid_sync_locked_at>now()-interval '15 minutes' from public.profiles where id=auth.uid()),false)
 ) where auth.uid() is not null and end_date>start_date and end_date-start_date<=93;
$$;
revoke all on function public.financial_budget_snapshot(date,date) from public,anon;
grant execute on function public.financial_budget_snapshot(date,date) to authenticated;
create or replace function public.scheduled_financial_budget_snapshot(owner_id uuid,start_date date,end_date date) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'user_id',owner_id,
 'planning_profile',(select financial_profile from public.profiles where id=owner_id),
 'transactions',coalesce((select jsonb_agg(to_jsonb(t)) from (select id,account_id,plaid_transaction_id,date,name,merchant_name,amount,pending,category,normalized_category,category_override,weekly_budget_override,monthly_budget_override,transaction_currency,pending_transaction_id,plaid_primary_category,plaid_detailed_category,plaid_category_confidence from public.transactions where user_id=owner_id and date>=start_date and date<end_date order by id limit 10001)t),'[]'::jsonb),
 'accounts',coalesce((select jsonb_agg(to_jsonb(a)) from(select id,account_name,institution_name,currency,persistent_account_id,weekly_budget_source,created_at,account_type,current_balance from public.accounts where user_id=owner_id order by id limit 501)a),'[]'::jsonb),
 'weekly_limit',(select weekly_limit from public.user_weekly_budgets where user_id=owner_id),
 'monthly_limit',(select monthly_limit from public.user_monthly_budgets where user_id=owner_id),
 'category_rules',coalesce((select jsonb_agg(to_jsonb(r)-'user_id') from public.budget_category_rules r where user_id=owner_id),'[]'::jsonb),
 'account_rules',coalesce((select jsonb_agg(to_jsonb(r)-'user_id') from public.budget_account_rules r where user_id=owner_id),'[]'::jsonb),
 'jobs',coalesce((select jsonb_agg(to_jsonb(j)-'user_id') from public.financial_job_status j where user_id=owner_id),'[]'::jsonb),
 'sync_in_progress',coalesce((select plaid_sync_lock_token is not null and plaid_sync_locked_at>now()-interval '15 minutes' from public.profiles where id=owner_id),false)
 ) where owner_id is not null and end_date>start_date and end_date-start_date<=93;
$$;
revoke all on function public.scheduled_financial_budget_snapshot(uuid,date,date) from public,anon,authenticated;
grant execute on function public.scheduled_financial_budget_snapshot(uuid,date,date) to service_role;
create or replace function public.weekly_budget_snapshot(start_date date,end_date date) returns jsonb language sql stable security invoker set search_path='' as $$
 select public.financial_budget_snapshot(start_date,end_date) where end_date>start_date and end_date-start_date<=14;
$$;
revoke all on function public.weekly_budget_snapshot(date,date) from public,anon;
grant execute on function public.weekly_budget_snapshot(date,date) to authenticated;
create or replace function public.financial_budget_policy() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('user_id',auth.uid(),
  'categories',coalesce((select jsonb_agg(to_jsonb(r)-'user_id') from public.budget_category_rules r where user_id=auth.uid()),'[]'::jsonb),
  'accounts',coalesce((select jsonb_agg(to_jsonb(r)-'user_id') from public.budget_account_rules r where user_id=auth.uid()),'[]'::jsonb),
  'monthly_limit',(select monthly_limit from public.user_monthly_budgets where user_id=auth.uid())
 ) where auth.uid() is not null;
$$;
revoke all on function public.financial_budget_policy() from public,anon;
grant execute on function public.financial_budget_policy() to authenticated;
commit;
