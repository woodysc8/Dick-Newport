# Shared financial budgeting engine

Implementation: `lib/transactionClassification.ts`, `lib/budgetEngine.ts`, `lib/financialBudgetData.ts`; authenticated routes `/api/budget-engine`, `/api/transactions/review`, existing `/api/weekly-budget` and `/api/transactions`. Overview, Budget, Reports, financialContext and the private briefing use the shared engine once the pending migration is approved. Existing monthly **planning** in profile JSON remains separate from observed spending. No historical rows are backfilled by this release.

## Classification and provenance

Manual category overrides win. Explicit HIGH/VERY_HIGH provider detailed mappings win over primary mappings. A narrow Bagel Express / Bagel Express on Broadway fallback applies only with absent/compatible food provider data. It cannot override transfer/loan/income/medical categories. Walgreens without reliable detail remains Needs review; pharmacy detail maps to healthcare, not groceries. Generic Payment alone remains Needs review. No broad merchant rule is inferred from a correction. Raw merchant, provider categories, confidence, dates and amounts remain intact.

Provenance is derived from original fields plus the explicit version-controlled mapping: user_override, provider_detailed, provider_primary, merchant_rule or needs_review. New Plaid imports persist the normalized automatic category; sync omits all manual preference fields. Reads recompute classification deterministically, so changing a mapping changes derived totals without rewriting history. Historical persisted normalized categories remain visible in dry-run comparisons.

Transactions → Preview reclassification performs an owner-scoped bounded read (current/previous month and current/previous week), displays before/after counts and at most 50 changed/ambiguous examples, and writes nothing. Select specific examples, choose category and separate weekly/monthly inclusion, then explicitly confirm to save. This is a user correction, not an automatic backfill. A live automatic backfill requires a separate approval and is intentionally not implemented/run. The existing category filter uses **stored** normalized category/user override; old Needs review rows may have a derived classification now. Use the dry-run preview to inspect this distinction. A full derived-category search across unlimited history is not implemented.

## Inclusion precedence

1. Currency, durable duplicate identity and account-source completeness are hard safety gates. Unsupported/unknown currencies never enter USD totals. Confirm one canonical underlying account source in Accounts/Budget; unknown identities require explicit review, never fuzzy matching or deletion.
2. Per-transaction weekly/monthly include/exclude.
3. Per-account weekly/monthly purchase inclusion.
4. Per-category weekly/monthly inclusion and optional caps.
5. Defaults.

Unknowns and financial movements are protected from a broad account purchase-inclusion rule; including them requires an explicit transaction or category decision. Source selection is shared canonical coverage, distinct from independent period inclusion rules. An excluded/duplicate source cannot be reintroduced by an individual purchase override.

Default weekly included: dining, coffee, nightlife, groceries, shopping, entertainment, hobbies, personal discretionary and explicitly other discretionary. Rent/housing excluded weekly and included monthly as fixed. Healthcare, gas, personal care and other essentials are not weekly discretionary by default; configure them separately. Transfers, card payments, loan payments, savings, investments and income are excluded from spending by default, but still represented in observed cash flow. Monthly groups: fixed, essential, discretionary, excluded. Optional caps are informational spending comparisons, not transaction rejection rules. Account and transaction inclusion can override category inclusion; cap/group settings do not override the inclusion decision.

## Calendar and formulas

Date-only posted effective transaction date, not insertion time. America/New_York calendar Monday through next Monday exclusive, and first-of-month through next first exclusive. DST uses local calendar dates via Intl, never 168-hour arithmetic. Current weeks/months are partial; comparison labels explicitly identify previous complete periods.

Money sums in cents. Net spending = max(0, included posted debits − explicitly classified eligible credits). Unmatched credits cannot increase allowance. No automatic refund/purchase fuzzy matching. Pending amounts are separate positive projections. Explicit Plaid pending_transaction_id suppresses the predecessor; database trigger preserves category and both inclusion overrides before predecessor removal. Exact provider identity and canonical durable account identity prevent repeated counting, while identical legitimate purchases remain separate.

Confirmed subtotal remaining = limit − posted net spending. Safe remaining/suggested daily allowance are unavailable when review, source/currency uncertainty or unrecorded/stale sync makes coverage provisional. Conservative remaining = confirmed subtotal remaining − positive needs-review amount − pending discretionary amount. This is still provisional, not a guaranteed safe-to-spend amount. $420 minus $527.26 of unknown debits is a **−$107.26 conservative estimate**, not $420 freely available. Review totals may include pending unknowns; pending included spending is separate, avoiding double subtraction of the same row. Unknown amounts cannot be estimated. Missing account coverage cannot be inferred from the imported ledger alone.

Remaining calendar days include today. Average daily = posted/days elapsed including today. Suggested daily = max(0, remaining−pending)/days remaining only when coverage is not provisional. Missing limits stay unset, explicit zero is valid. The migration never sets/replaces the existing $420 limit. Weekly/monthly limits and caps are USD-only and accept cents, nonnegative through $100,000,000.

## Security and limitations

All APIs verify Supabase getUser; browser mutations enforce same-origin and bounded JSON. Reads are owner-filtered and protected by RLS. A single bounded snapshot prevents mixed totals during sync; >10,000 transactions/>500 accounts or an active sync returns unavailable rather than a partial total. Invoker RPCs enforce auth.uid ownership. Bulk review is atomic, validates all IDs and is capped at 50. Preference changes are recorded without amounts/merchant/provider secrets in owner-scoped append-only audit entries. This is an application audit trail, not a tamper-proof compliance ledger; the owner can insert their own audit entries through RLS. No SECURITY DEFINER functions are added.

Freshness becomes recorded after approved activation of durable job tracking. Old successful syncs are not invented. Partial/failed syncs do not record a fresh complete success. Existing sync cursor buffering/replay and per-user credential operation locks remain; no new paid `/transactions/refresh` request or reconnect is introduced. Missing durable identities still require human source selection.

## User activation

After explicit migration approval, open Budget, preserve the saved $420, confirm source coverage, preview review candidates and confirm selected corrections. Set category caps and independent weekly/monthly rules as desired. Keep monthly profile planning unchanged. Test new rules using Preview before approving any private document publish. See migration-rollout.md and scheduled-financial-sync.md.
