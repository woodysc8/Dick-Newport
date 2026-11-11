# Transactions and weekly discretionary budget

## Architecture

`/transactions` is an authenticated server page hosting a responsive transaction browser. Desktop uses a table; mobile uses cards. Both offer details and category/inclusion corrections. `GET /api/transactions` supplies at most 50 rows plus a bounded account list, ordered by posted date then row ID descending. Search, account, effective category, inclusive date range, pending/posted status, and page are validated on the server. Filter submissions reset pagination. Detail panels show safe provider classification, confidence, automatic classification, user decisions, and the inclusion explanation.

`GET /api/weekly-budget` reads current and previous calendar weeks from Supabase and computes totals on the server. Overview embeds the weekly card and six recent transactions. Budget includes limit editing, category breakdowns, full previous-week comparison, and source selection before the unchanged monthly planning sections. Accounts also provides source selection. No page calls Plaid automatically. Existing financial profile, monthly settings, net worth, accounts, investments and refresh controls remain in place.

Core calculation: `lib/discretionaryBudget.ts`. Bounded queries: `lib/transactionData.ts`. Authentication/request protection: `lib/transactionRoute.ts`. UI: `app/components/TransactionsWorkspace.tsx` and `WeeklyBudget.tsx`. `lib/transactionSyncBatch.ts` buffers and validates a complete sync update before persistence.

## Additive schema

Pending migration: **`supabase/migrations/20261112010000_transactions_weekly_budget.sql`**.

- `user_weekly_budgets`: one row per profile, nullable USD weekly limit, fixed `America/New_York` timezone, and update timestamp. No row or amount is created merely by reading the feature. Limits must be nonnegative, within the documented application bound, and have cent precision at the API.
- `accounts`: optional provider `persistent_account_id` and `weekly_budget_source` (`review`, `include`, `exclude`), initially `review`.
- `transactions`: original Plaid primary/detailed category and confidence, original transaction currency, explicit pending predecessor ID, automatic normalized category, separate nullable user category and weekly inclusion overrides. Category and inclusion enumerations have CHECK constraints. Existing legacy category text and transaction identities remain intact.
- Owner/category/date and pending-identity indexes plus an owner/persistent-account index.
- An invoker-rights trigger copies user preferences from the same owner's explicitly linked pending predecessor on posted insertion. It never matches descriptions, amounts, or dates.

The migration is transactional and replay-safe (`IF NOT EXISTS`, replaced function, recreated trigger/policy). It does not backfill automatic classifications from ambiguous legacy text, alter old migration files, reset users, reconnect Items, or delete transactions. Existing rows start in Needs review. Existing profile/account ownership foreign keys remain; settings cascade only when their owning profile is deleted. The new settings table has owner RLS with explicit grants and no anonymous access. The pending trigger uses the existing composite owner/account relationship.

## Classification and source rules

Only high/very-high-confidence modern Plaid categories auto-classify. Dining, coffee, nightlife, groceries, retail and entertainment are discretionary. Transfers, card payments, loan payments, housing, utilities, insurance, taxes and income are excluded. Health, transport, services, missing categories and lower confidence stay in Needs review because those may be fixed obligations. Hobbies, personal purchases, other discretionary spending, investments, savings and other fixed obligations can be selected explicitly. Merchant descriptions never drive automatic inclusion. Modern category metadata is stored alongside the original legacy category, when available.

User category overrides take precedence over automatic classification. Explicit transaction inclusion/exclusion takes precedence over category rules. Account-source selection and currency safety take precedence over all per-transaction decisions. Resetting corrections to automatic clears only user fields.

**Confirm one source per underlying account before relying on totals.** Repeated Plaid connections can have different account and transaction IDs. Where Plaid supplies a durable persistent account identity, only the oldest confirmed source contributes; additional matching sources are excluded nondestructively. Where that identity is unavailable, users must explicitly exclude redundant sources in Budget/Accounts. Accounts start unconfirmed, and their transactions remain Needs review. There is no fuzzy deletion or fuzzy transaction matching. A legitimate pair of purchases with identical descriptions/dates/amounts still counts twice. The existing owner/provider-transaction uniqueness index handles exact provider identity replays.

## Weekly formulas and dates

Weeks run Monday 00:00 local time through the next Monday 00:00, exclusively, in America/New_York. The UI labels Monday–Sunday. Date-only transaction dates are compared to local calendar dates; insertion timestamps are irrelevant. Calendar arithmetic uses date components rather than subtracting seven 24-hour intervals, including across both DST transitions and year boundaries.

- Posted net discretionary spending = max(0, included posted debits − explicitly eligible posted credits).
- Remaining = configured weekly limit − posted net discretionary spending. Negative remaining is retained.
- Percentage used = posted / limit × 100. An unset limit has no percentage; zero limit uses 0% for zero spending and 100% for positive spending, with overage shown separately. The visual progress bar caps at 100%.
- Over-budget amount = max(0, −remaining).
- Average daily = posted / elapsed calendar days including today.
- Suggested remaining daily = max(0, remaining) / remaining calendar days including today.
- Previous week uses the full prior week; the displayed comparison is current week to date minus the full previous week, not a matched-day forecast.

Calculations sum integer cents. Only known USD transactions contribute; provider currency takes precedence over account currency. Other and unknown currencies are counted separately, never converted. Unsupported currencies remain readable in the transaction browser. Missing/invalid amounts require review. Unknown amounts do not become zero spending.

## Credits, pending, removal and partial updates

Plaid positive amounts mean debits; negative amounts mean credits. The browser labels both directions explicitly. An unmatched credit never offsets the budget automatically. A user must explicitly assign a discretionary category or include it for the credit to offset spending. Net spending is floored at zero, so credits cannot create allowance above the limit. Category breakdowns preserve signed eligible credits and may not sum to the zero-floored net when credits exceed spending. No automated refund-to-purchase linkage is inferred.

Pending positive discretionary purchases appear only in projected spending. Pending credits do not increase projected allowance. An explicit provider pending-to-posted link suppresses the predecessor if both are observed, including across pages. Sync buffers all pages, restarts from the original cursor on a pagination mutation (bounded retries), processes additions/modifications before removals, and deletes a linked pending row only after posted persistence succeeds. The database trigger preserves pending user decisions during the posted insert. Provider updates never write the user override or account-source columns. Removed records are deleted only for the current owner and Item account; ambiguous orphan removals fail closed. The terminal Item cursor is saved only after all persistence succeeds. Replays use durable provider identities, with existing race recovery and locks retained.

Row writes and cursor save are not a single database transaction. An interrupted persistence run can leave some imported rows visible; the original cursor remains and idempotent replay completes the update. Do not interpret a view during an active/failed refresh as a complete historical import. No intermediate cursor is persisted. The buffering limit is 50,000 changes/100 provider pages, requiring an administrator-reviewed larger batch strategy if exceeded; it never silently skips updates.

Weekly reads use an invoker-rights `weekly_budget_snapshot(date,date)` function: one statement reads settings, safe account/transaction fields and sync-lock state from the same database snapshot. The function uses `auth.uid()`, RLS and a maximum 14-day interval, returning at most 10,001 rows and 501 accounts as sentinel-bounded arrays. The server rejects more than 10,000 transactions, more than 500 accounts, an owner mismatch, or an active sync; it never calculates a truncated or in-progress total. This also avoids drifting pagination offsets and the Data API row cap. Larger deployments should replace this bounded reducer with an audited database aggregation. The browser receives only metrics and safe account metadata from the weekly endpoint. The transaction browser is capped at 1,000 pages (50,000 rows accessible through pagination); it never fetches unlimited history.

## Security

Every API read/write verifies Supabase Auth and uses the user-bound publishable-key client, RLS, and an explicit verified-user filter. The weekly snapshot function derives ownership from `auth.uid()` and its returned owner is checked against the verified context; it accepts no user ID. Anonymous function execution is revoked. Query/body-supplied user IDs cannot change ownership. Updates allow only user override fields, weekly limit, or account-source choice. Mutations use the existing same-origin protection and bounded JSON reader. Requests validate UUIDs, dates, categories, paging, amounts, and keys. Safe fixed error messages and no-store responses prevent provider/database details or shared caching. No new service-role client, token query, browser credential storage, sensitive logging, or financial data in test output was introduced.

The existing transactions/accounts RLS and composite account-owner FK were reviewed. The credential tables, AES-GCM encryption, Item ownership, keys, and connection lifecycle are unchanged. Per-user developer credentials remain exclusive; there is no shared/global fallback.

## Rollout — requires explicit database deployment approval

1. Review the pending migration and disposable database tests. Back up according to the project's normal operational process. Schedule the additive DDL before running the updated refresh code.
2. **Do not blindly run `supabase db push`.** Read-only remote history confirms personal credentials at `20261111213655_personal_plaid_credentials`; the local file is `20261111210821_personal_plaid_credentials.sql`. Both describe the already-applied credential migration. An administrator must review/reconcile migration history separately; do not replay that DDL or replace its local file.
3. With explicit approval, apply only the new weekly-budget migration using the team's reviewed migration procedure, recording exactly `20261112010000`. This task does not apply it or repair history.
4. Verify columns, RLS/grants and indexes, then restart/deploy the updated app. Before migration, the new cards/API show unavailable/retry guidance; existing dashboard data remains usable. Updated Plaid persistence also needs the new columns, so avoid live refresh until migration completes.
5. Open Transactions. Existing legacy rows remain Needs review until corrected or updated with modern provider metadata. No broad live resync, token rotation, or data backfill is automatic.
6. In Budget or Accounts, confirm one healthy source per underlying account and exclude repeated connections. In Budget, set the desired weekly USD limit (or leave it unset). Correct ambiguous transactions from their detail panels.
7. If history is missing, explicitly authorize and use the existing **Refresh saved connections** action; never reconnect just to populate this feature. Plaid product entitlement, institution support and fresh history remain dependent on that user's developer account. No new products, add-ons, Link sessions or webhooks are required by the transaction browser.

Rollback: revert the application commit first and leave additive data/schema in place. This preserves corrections/settings for a later fix. Do not drop columns/tables as an automatic rollback; doing so would destroy new user preferences. A destructive schema rollback requires a separately reviewed backup/export and approval. No live database changes were made during this task.

## User instructions

Use Transactions in the main navigation. Apply search/filters, move through 50-row pages, and choose Review for provider details, category corrections, and weekly inclusion overrides. Save corrections explicitly. The original Plaid category stays visible. Clear a correction to restore automatic rules.

Use Budget → Weekly Spending to set/edit/clear a USD weekly limit, confirm account sources, inspect posted/pending spending, and follow category/week links into Transactions. Monthly income, recurring expenses and savings planning remain separate. Overview shows the weekly subtotal, remaining allowance, progress, review count and six newest transactions. Review omitted sources/categories/currencies before relying on the allowance.

## Validation

Vitest covers calendar/DST boundaries, category confidence and protected exclusions, credits, pending links, durable source deduplication without fuzzy deletion, user overrides, empty/unset/over-budget states, currencies, filtering/pagination, owner-scoped API writes, malformed/oversized/cross-origin requests, UI loading/error/retry, migration replay/RLS/FKs, pending preference inheritance, monthly-profile preservation, pagination restart and sync failure replay. Fixtures are synthetic and database tests use disposable PGlite; no live financial records are changed. See the final delivery report for final command results and counts.

Final validation (2026-11-11): **416 tests passed, 1 opt-in live RLS test skipped**, across 43 passing test files. TypeScript and production build passed. Changed-file ESLint passed with the same 20 existing Overview warnings and no errors/new warnings. Full ESLint remains at the baseline **31 errors and 21 warnings** in existing accounting/classification code and unused Overview declarations. The existing external package-lock build warning remains. The built server booted; unauthenticated GET/PATCH Transactions and GET/PUT/PATCH Weekly Budget all returned JSON 401, and the Transactions page sent the login redirect through Next's streaming response. No authenticated live writes or Plaid requests were made.

The connected Plaid workflow checklist did **not** reach full acceptance: its live Sandbox Link → exchange → product-call check was recorded as failed/unverified because this task prohibits unnecessary live Plaid calls. All checklist items were reported; this is a remaining live-integration validation gap, not a failing Vitest test. No live-validation success is claimed.

## File manifest

```text
PLAID_PLAN.md
app/api/transactions/route.ts
app/api/transactions/weeklyRoutes.test.ts
app/api/weekly-budget/route.ts
app/components/FinanceNav.tsx
app/components/FinancePage.tsx
app/components/PlaidConnect.tsx
app/components/TransactionsBudget.test.tsx
app/components/TransactionsWorkspace.tsx
app/components/WeeklyBudget.tsx
app/page.tsx
app/transactions/error.tsx
app/transactions/loading.tsx
app/transactions/page.tsx
docs/transactions-weekly-budget.md
lib/discretionaryBudget.test.ts
lib/discretionaryBudget.ts
lib/financeHttp.ts
lib/plaidRefresh.test.ts
lib/plaidRefresh.ts
lib/transactionData.test.ts
lib/transactionData.ts
lib/transactionRoute.ts
lib/transactionSyncBatch.test.ts
lib/transactionSyncBatch.ts
lib/weeklyBudgetMigration.test.ts
supabase/migrations/20261112010000_transactions_weekly_budget.sql
```

Known limits: timezone is fixed to New York and currency to USD for this release; optional category-wide preferences are not added. Refund linking is explicit classification only. Durable account IDs are not available for every institution, so source review is required. Existing webhook/update-mode/OAuth production validation remains outside this stored-data feature. Live imported data, migrations on the remote project, and real Plaid end-to-end behavior were not modified or verified by real calls.
