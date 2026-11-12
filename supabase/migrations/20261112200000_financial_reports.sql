-- Local implementation approved; application/activation still requires approval.
-- Additive only. Does not change existing finance data or jobs.
create table public.financial_report_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  generated_at timestamptz not null,
  schema_version integer not null default 1 check (schema_version = 1),
  report jsonb not null check (jsonb_typeof(report) = 'object' and coalesce(report->>'version' = '1', false) and octet_length(report::text) <= 2097152),
  schedule_key text check (schedule_key is null or length(schedule_key) <= 64),
  unique (user_id, schedule_key),
  check ((report->>'generatedAt') is not null and (report->>'generatedAt')::timestamptz = generated_at)
);
create index financial_report_owner_date on public.financial_report_snapshots(user_id, generated_at desc, id desc);
alter table public.financial_report_snapshots enable row level security;
revoke all on public.financial_report_snapshots from public, anon, authenticated, service_role;
grant select, insert on public.financial_report_snapshots to authenticated, service_role;
create policy reports_read_own on public.financial_report_snapshots for select to authenticated using ((select auth.uid()) = user_id);
create policy reports_insert_own on public.financial_report_snapshots for insert to authenticated with check ((select auth.uid()) = user_id and schedule_key is null);
create function public.reject_financial_report_update() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Saved financial reports are immutable' using errcode = '42501'; end;
$$;
revoke all on function public.reject_financial_report_update() from public, anon, authenticated;
create trigger financial_report_immutable before update on public.financial_report_snapshots for each row execute function public.reject_financial_report_update();

create table public.financial_report_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weekly boolean not null default false,
  monthly boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.financial_report_preferences enable row level security;
revoke all on public.financial_report_preferences from public, anon, authenticated, service_role;
grant select, insert, update on public.financial_report_preferences to authenticated;
grant select on public.financial_report_preferences to service_role;
create policy report_preferences_read on public.financial_report_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy report_preferences_insert on public.financial_report_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy report_preferences_update on public.financial_report_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
