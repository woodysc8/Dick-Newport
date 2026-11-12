# Dashboard accuracy pass

No live records or connections were inspected or changed. Reported dollar amounts are examples, not verified balances.

- The weekly card reads `user_weekly_budgets` through `weekly_budget_snapshot`; the old onboarding prompt read `financial_profile.weeklySpending.weeklyTarget`. Setup/review now belongs to the weekly card, using its actual saved limit. No limit is rewritten.
- Recent transactions require `monthly_budget_override` and `financial_budget_policy`. Both are supplied by pending `20261112020000_budget_briefing_jobs.sql`. The older weekly RPC can still work without them. The read failure must stay visible until schema readiness is approved and verified; it is not evidence of an empty ledger. The live failure cause remains unverified.
- Institution ingestion gap: `app/api/plaid/exchange-token/route.ts` inserts the Item without institution metadata. `lib/plaidRefresh.ts` copies the Item's name to accounts, substituting `Unknown Institution` when absent. Dashboard reads then display the persisted value. This pass labels missing metadata honestly; it does not infer identities, change Plaid calls, or backfill historical records. A future ingestion fix should resolve authoritative institution metadata server-side and receive Plaid-specific validation.
- Connected investment balances and holdings have independent coverage. Missing holdings no longer imply zero securities or that the entire account balance is cash. Holdings query errors remain visible; investment freshness is explicitly unverified.
- The monthly recurring estimate comes from saved profile inputs via `calculateFinancialPlanning` / `estimateMonthlyRecurringExpenses`. The reported $834 and its individual obligations were not verified. It is not combined with the weekly target equivalent: food, subscriptions, debt payments and rent may overlap. The weekly engine still includes groceries and excludes rent by default, with Monday–Sunday in America/New_York.
- Briefing preview and scheduled generation use the same bounded owner-scoped detail reads. No new endpoint, scheduler activation or publishing occurs. Missing card terms, security asset classes, and verified Roth contributions remain unavailable. Configured payday/bill dates are plans, not verified future cash flow.

## Activation and validation

The pending migration still requires approval. The existing local/remote migration timestamp mismatch has not been repaired; compare history before any separately authorized migration work. No schema change is introduced here. Existing private Google Docs authorization and scheduler opt-ins still apply; publication and scheduling remain separate authorized actions.

Use the tiers in `AGENTS.md`. `test:fast` covers the dashboard/briefing subset; `test:financial` covers shared money calculations and authorization with fixtures; `test:all` retains the full existing suite. Database migration tests and live RLS tests are intentionally outside the default tiers. No tests were removed. No slow-test removal is proposed without timing evidence.
