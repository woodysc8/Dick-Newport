# Dick Newport template generalization audit

## Current implementation

- Supabase Auth signup, confirmation callback, sign-in, sign-out, and cookie refresh use `@supabase/ssr` with the publishable key. The dashboard, onboarding, profile editor, and personal-data APIs verify the session before access.
- The authenticated user's configurable assumptions are saved in `profiles.financial_profile` JSONB. Profile ownership for writes is derived from `auth.getUser()` in the server action.
- New profiles use blank starter values. Legacy financial assumptions remain in `LEGACY_EXAMPLE_FINANCIAL_PROFILE` and are only selected by the explicit local development flag.
- Plaid API entry points remain disabled. `app/components/PlaidConnect.tsx` is not rendered, and no active route imports `lib/plaidRefresh.ts`.

## Development database facts verified read-only

On 2026-10-28, the dedicated Dick-Newport development project exposed nine `public` tables. All had RLS enabled and zero rows at inspection time.

| Table | Verified policy |
| --- | --- |
| `profiles` | Authenticated select, insert, and update policies bind `id` to `auth.uid()`; update includes matching `USING` and `WITH CHECK`. |
| `accounts`, `transactions`, `budgets`, `financial_goals`, `financial_settings`, `investment_holdings`, `investment_snapshots` | Each has an authenticated `ALL` owner policy binding `user_id` to `auth.uid()` in both `USING` and `WITH CHECK`. |
| `plaid_items` | RLS enabled with no policies; this intentionally prevents client access to access tokens. |

The security advisor reported only the expected `plaid_items` RLS-enabled-with-no-policy notice. No policies or schema were changed during this audit.

The profile JSONB column is nullable. The typed table relationships point each financial table's `user_id` to `profiles.id`, and `profiles.id` to `auth.users.id`.

## Access paths and outstanding ownership risks

- Dashboard reads in `app/page.tsx` use a cookie-bound authenticated client and filter each financial query by the verified user ID. RLS is an additional boundary.
- `app/api/financial-context/route.ts`, `app/api/accounting/audit/route.ts`, and `app/api/transactions/classify/route.ts` authenticate each request and filter by `auth.user.id`.
- `app/api/mcp/route.ts` requires a verified bearer user and reads through that request's authenticated client. It does not read `plaid_items` or forward the bearer token to an origin derived from the request Host.
- `app/profile/actions.ts` reads and updates only the authenticated profile row. It ignores submitted owner IDs.
- `lib/plaidRefresh.ts` remains an isolated legacy helper containing a fixed user UUID and service-role client. It is not imported by active routes, but must be removed or redesigned before any Plaid endpoint is re-enabled. No `client_user_id` field was found in active routes.
- The repository contains no live two-user integration result yet. `lib/supabase/rls.integration.test.ts` is an opt-in test using two explicitly designated disposable users; it writes uniquely marked synthetic `financial_goals` rows and deletes only those rows through each owner's authenticated session. It was not run because dedicated test credentials and IDs are not configured in the current process.

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
2. Run the opt-in two-user RLS test with dedicated disposable accounts. Do not use real users or real financial data for the test.
3. Implement currency-aware aggregation or constrain the dashboard to one verified account currency; formatting alone is not conversion.
4. Decide how debt payments and retirement contributions affect planned savings without double-counting amounts already present in spending categories or take-home income.
5. Keep Plaid disabled until Item ownership, service-role use, and cleanup/synchronization are redesigned for authenticated user ownership.
