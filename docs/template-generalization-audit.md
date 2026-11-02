# Dick Newport template generalization audit

## Current implementation

- Supabase Auth signup, confirmation callback, sign-in, sign-out, and cookie refresh use `@supabase/ssr` with the publishable key. The dashboard, onboarding, profile editor, and personal-data APIs verify the session before access.
- The authenticated user's configurable assumptions are saved in `profiles.financial_profile` JSONB. Profile ownership for writes is derived from `auth.getUser()` in the server action.
- New profiles use blank starter values. Legacy financial assumptions remain in `LEGACY_EXAMPLE_FINANCIAL_PROFILE` and are only selected by the explicit local development flag.
- Plaid API entry points remain disabled. `app/components/PlaidConnect.tsx` is not rendered, and no active route imports `lib/plaidRefresh.ts`.

## Development database facts verified read-only

On 2026-10-29, a read-only catalog inspection of `Dick-Newport-Dev` verified all nine listed `public` tables exist and have RLS enabled. Every listed policy is permissive and applies to `authenticated`; `FORCE ROW LEVEL SECURITY` is off for all nine tables. No other policies were returned for these tables. The `auth.uid()` expressions below are the expressions returned by PostgreSQL's policy catalog.

| Table | RLS / FORCE | Policy | Command / role | `USING` | `WITH CHECK` |
| --- | --- | --- | --- | --- | --- |
| `profiles` | enabled / off | `profile_select_own` | SELECT / `authenticated` | `(( SELECT auth.uid() AS uid) = id)` | — |
| `profiles` | enabled / off | `profile_insert_own` | INSERT / `authenticated` | — | `(( SELECT auth.uid() AS uid) = id)` |
| `profiles` | enabled / off | `profile_update_own` | UPDATE / `authenticated` | `(( SELECT auth.uid() AS uid) = id)` | `(( SELECT auth.uid() AS uid) = id)` |
| `accounts` | enabled / off | `accounts_manage_own` | ALL / `authenticated` | `(( SELECT auth.uid() AS uid) = user_id)` | `(( SELECT auth.uid() AS uid) = user_id)` |
| `transactions` | enabled / off | `transactions_manage_own` | ALL / `authenticated` | `(( SELECT auth.uid() AS uid) = user_id)` | `(( SELECT auth.uid() AS uid) = user_id)` |
| `budgets` | enabled / off | `budgets_manage_own` | ALL / `authenticated` | `(( SELECT auth.uid() AS uid) = user_id)` | `(( SELECT auth.uid() AS uid) = user_id)` |
| `financial_goals` | enabled / off | `financial_goals_manage_own` | ALL / `authenticated` | `(( SELECT auth.uid() AS uid) = user_id)` | `(( SELECT auth.uid() AS uid) = user_id)` |
| `financial_settings` | enabled / off | `financial_settings_manage_own` | ALL / `authenticated` | `(( SELECT auth.uid() AS uid) = user_id)` | `(( SELECT auth.uid() AS uid) = user_id)` |
| `investment_holdings` | enabled / off | `investment_holdings_manage_own` | ALL / `authenticated` | `(( SELECT auth.uid() AS uid) = user_id)` | `(( SELECT auth.uid() AS uid) = user_id)` |
| `investment_snapshots` | enabled / off | `investment_snapshots_manage_own` | ALL / `authenticated` | `(( SELECT auth.uid() AS uid) = user_id)` | `(( SELECT auth.uid() AS uid) = user_id)` |
| `plaid_items` | enabled / off | none | none | — | — |

For `profiles`, there is no DELETE policy. `plaid_items` has no client policy, so RLS denies ordinary `anon` and `authenticated` row access; privileged roles such as `service_role` can bypass RLS. The security advisor reported an informational `RLS Enabled No Policy` finding for `plaid_items` and a warning that leaked-password protection is disabled. No policies, schema, or Auth settings were changed.

Historical note: a separate inspection on 2026-10-28 observed zero rows in the then-existing public tables. Row counts were not queried during the 2026-10-29 policy inspection.

The profile JSONB column is nullable. The typed table relationships point each financial table's `user_id` to `profiles.id`, and `profiles.id` to `auth.users.id`.

## Access paths and outstanding ownership risks

- Dashboard reads in `app/page.tsx` use a cookie-bound authenticated client and filter each financial query by the verified user ID. RLS is an additional boundary.
- `app/api/financial-context/route.ts`, `app/api/accounting/audit/route.ts`, and `app/api/transactions/classify/route.ts` authenticate each request and filter by `auth.user.id`.
- `app/api/mcp/route.ts` requires a verified bearer user and reads through that request's authenticated client. It does not read `plaid_items` or forward the bearer token to an origin derived from the request Host.
- `app/profile/actions.ts` reads and updates only the authenticated profile row. It ignores submitted owner IDs.
- `lib/plaidRefresh.ts` remains an isolated legacy helper containing a fixed user UUID and service-role client. It is not imported by active routes, but must be removed or redesigned before any Plaid endpoint is re-enabled. No `client_user_id` field was found in active routes.

## RLS integration-test evidence and limits

- The repository owner reported that 7/7 file-level tests passed against `Dick-Newport-Dev` on 2026-10-29. This is reported evidence; this documentation-only change did not independently reproduce the run. The file contains six local cleanup-helper tests and one live Supabase integration test, so the seven-test total is not seven independent live database tests.
- The live integration case exercises profile isolation (own and cross-owner reads, cross-owner updates, anonymous reads and updates) and `financial_goals` (own inserts and reads, cross-owner and anonymous insert attempts, anonymous reads, cross-owner update/delete attempts, and owner deletion).
- Runtime integration coverage currently exercises only `profiles` and `financial_goals`. Policies on `accounts`, `transactions`, `budgets`, `financial_settings`, `investment_holdings`, and `investment_snapshots` have catalog verification only; the integration test does not exercise those tables.
- The test uses per-run UUID markers and exact synthetic goal names, verifies cross-owner and anonymous write attempts did not create rows by querying as the expected owner, verifies the other owner's row remains, deletes only exact synthetic names scoped to each owner and confirms none remain, restores and verifies a profile if an unexpected update changes it, and checks sign-out results.
- Profile insert is not probed: the setup requires each disposable identity to already have a profile row, so inserting that same ID collides with an existing row. Inserting a different synthetic profile ID would create a profile detached from a disposable auth identity and has no safely verified cleanup path in this harness.
- Other `user_id` financial tables are not write-probed. The repository does not contain their base schema or complete constraints, so safe synthetic fixtures and foreign-key cleanup cannot be established from the available files. Their policies are supported by the earlier live read-only policy inspection recorded above, not by the integration test.

## Proposed plan to version the verified RLS configuration

The repository currently has two timestamp-prefixed additive migrations (`20260914180000_add_plaid_sync_state.sql` and `20261005120000_add_securities_value_to_investment_snapshots.sql`) but no base table or RLS-policy migrations. The live tables and policies may therefore have been created outside this repository's migration history.

Before authorizing an executable migration:

1. Establish the source and migration-ledger status of the existing nine tables; capture their complete schemas, constraints, grants, RLS state, and policies from an approved development baseline.
2. Decide whether to create a formal baseline for the existing schema or to add forward migrations that reconcile the already-provisioned project. A plain `CREATE POLICY` migration would collide with policies that already exist on `Dick-Newport-Dev` unless migration history is reconciled deliberately.
3. Prepare a timestamp-prefixed migration for review that reproduces the verified authenticated owner policies: the three `profiles` policies and the seven `*_manage_own` policies. Preserve `plaid_items` RLS with no client policy; do not add a user-facing token policy. Preserve the verified `FORCE ROW LEVEL SECURITY` state unless separately reviewed.
4. Validate the migration plan against a disposable Supabase branch and an independent policy-catalog query before considering application to the development project.

No migration was created or applied during this documentation update. Migration-history reconciliation and authorization to change the database remain decisions for a separate task.

## Financial calculation caveats

- Take-home pay is normalized to monthly only for weekly, biweekly, semimonthly, and monthly frequency. Gross pay does not feed the spendable-income budget. “Other / variable” income is stored but not normalized.
- Unknown inputs remain unset. Budget and weekly-target calculations now return unavailable/null for unset values; an explicit zero remains a value.
- Manual cash and savings estimates remain separate from connected account balances and are excluded from net worth.
- Debt payments are stored separately and are not automatically added to spending-category targets, avoiding accidental duplicate counting. Users must include them in a category if they want them counted.
- Retirement contribution preferences and financial goals are saved and shown but are not automatically included in budget savings arithmetic.
- The chosen profile currency controls formatting; no foreign-exchange conversion is implemented. Connected-account and transaction totals assume a common currency. Multi-currency accounts can therefore make combined totals incorrect and need per-currency reporting or an approved conversion design before broad beta use.
- Account-purpose and transaction classification rules still include vendor/category-specific rules. Dashboard institution labels were generalized, but classification-specific compatibility behavior remains.

## Before a safe beta

1. Configure and verify production email confirmation, redirect allowlists, trusted site URL, password recovery, and session revocation behavior.
2. Re-run the opt-in two-user RLS test with dedicated disposable accounts after future RLS or authentication changes; do not use real users or real financial data for the test.
3. Implement currency-aware aggregation or constrain the dashboard to one verified account currency; formatting alone is not conversion.
4. Decide how debt payments and retirement contributions affect planned savings without double-counting amounts already present in spending categories or take-home income.
5. Keep Plaid disabled until Item ownership, service-role use, and cleanup/synchronization are redesigned for authenticated user ownership.
