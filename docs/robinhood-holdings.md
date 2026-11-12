# Robinhood holdings implementation proposal

No live consent, holdings request, bank refresh, migration application or deployment is authorized as part of development.

## Local schema proposal

Add `accounts.holdings_status` (default `not_synced`) and `accounts.holdings_synced_at` (nullable last successful import). These distinguish permission-required, unsupported, not-ready, missing-from-response, failed, successfully populated and explicitly empty accounts. Failed requests retain the last successful timestamp and positions.

Add one service-role-only, security-invoker RPC for atomic holdings import. It verifies the explicitly authenticated owner, active Item and credential association; validates all returned accounts/securities/holdings before writing; imports only accounts from that Item; uses existing holding unique keys; replaces stale positions only for accounts explicitly included in a complete successful response; and updates their status in the same database transaction. Duplicate identical positions are collapsed; conflicting duplicates or incomplete responses fail before writes. No new tables, no history backfill, no changes to existing RLS. A failed import rolls back all account/holding changes. Existing transaction cursors, access tokens and historical transactions stay unchanged.

Local migration/code/tests were approved in this session. Applying `supabase/migrations/20261112190754_investment_holdings_consent_sync.sql` remains a separate approval. The existing migration timestamp mismatch is not repaired. An unapplied migration disables holdings sync with a clear message before a holdings API call; stored account balances and existing pages remain available.

## Consent and API flow

Use the existing disabled investment-update token route for user-initiated update-mode Link. Add `/api/plaid/holdings` for stored status, post-consent verification and explicit holdings-only sync. Use internal owner-scoped connection UUIDs in browser requests. Resolve encrypted access tokens only on the server with the Item's original credential record. Check institution eligibility using verified `/item/get` institution metadata and `/institutions/get_by_id`, then request `additional_consented_products: [investments]` with the existing access token and no required products. Verify consent using `/item/get` after Link; Link completion alone is never authorization. Never exchange an update-mode public token or overwrite its access token.

If update-mode upgrade is unavailable, offer a separate Investments Link session explicitly. Preserve all existing Items. Verify the new Item's actual authorized products before recording Investments access. No consent path automatically syncs transactions or holdings. The separate **Sync holdings** action calls `/investments/holdings/get`, not the separately entitled `/investments/refresh` add-on. It imports Plaid's latest available data; this does not promise a fresh brokerage fetch or real-time prices.

## Display and accuracy

Group positions under actual stored accounts (Individual, Roth IRA and Crypto when returned). Show supported quantities, price, market value, cost basis and shared unrealized gain/loss calculations. Missing data remains unavailable. Holdings are not added to account balances in net worth. Durable provider identities deduplicate proven duplicate accounts; ambiguous overlapping investment connections prevent a definitive net-worth aggregate rather than silently counting twice.

Trade history is a separate investigation. Plaid offers `/investments/transactions/get` with pagination and limited history, and optionally tax lots with original purchase timestamps. Neither is currently stored. Do not call it during holdings sync or substitute settlement/connection/update timestamps for acquisition dates. Display **Purchase history unavailable**.

Installed Plaid SDK 45 exposes investment transaction `date` as posting/typically settlement date, and optional `transaction_datetime` as institution-provided order initiation time. The currently installed field is not `order_datetime`. Optional `Holding.tax_lots[].original_purchase_datetime` can identify lot acquisition timestamps when provided. Up to 24 months of transaction history does not reconstruct all currently held lots, especially transfers-in and older purchases. A later history importer would need its own consent/cost review, complete pagination, cancellation handling and local storage approval. No history endpoint is called or new acquisition storage introduced here.

## Required user actions / unverified production setup

1. Separately approve and apply the local migration, accounting for the existing `20261112020000` / `20261112161751` migration timestamp mismatch. Do not indiscriminately push migration history or access the separate RLS test project.
2. Confirm Investments entitlement in the same personal Plaid Dashboard/environment as the existing Items. If OAuth is required, register the exact `/investments` return URI and configure server-only `PLAID_REDIRECT_URI`. Use a DTM-enabled customization with the investment use case if required (`PLAID_INVESTMENTS_LINK_CUSTOMIZATION`). No environment values or Dashboard settings are changed by this implementation.
3. On Investments choose **Enable holdings**, open Link and grant consent. Update-mode completion verifies `/item/get`; it does not exchange a token or fetch positions. If an upgrade fails, explicitly choose **Add separate investment connection**. The original Items and tokens stay unchanged.
4. Separately choose **Sync holdings** to authorize the live import. It uses only `/investments/holdings/get`. It never requests extraction via the paid refresh add-on or calls trading, transfer, withdrawal or investment-history endpoints. Failed/not-ready states require a user retry; there are no polls, automatic retries, scheduled holdings jobs or new webhook dependencies.

Production product entitlements, Robinhood institution eligibility, actual account/crypto coverage and end-to-end live/Sandbox consent have not been verified through provider calls during development. Local mocked tests and PGlite tests are not live integration proof. A separate connection may add billing and ambiguous account coverage; net-worth totals remain unavailable where duplicate identity cannot be resolved safely. Existing saved report snapshots are never regenerated automatically.

## Local validation

The full local suite passed 644 tests with one hosted RLS test skipped. Subsequent focused checks passed all six Investments page tests (including the new explicit-empty case) and all 16 holdings consent/import tests (including ambiguous RPC transport outcomes). TypeScript, changed-file ESLint and the final production build passed. Real unauthenticated local HTTP checks returned 401 from holdings GET/POST and the consent-token POST, and 307 from `/investments`. No live authenticated provider call, database migration application, bank refresh or deployment was performed. The separate RLS project was not accessed.

`npm run test:holdings` covers the affected integration modules for future small changes. Local PGlite tests prove idempotence, cross-owner/Item isolation, explicit-empty replacement, preservation of omitted accounts, RPC role restrictions and rollback after a later-row failure. Provider errors preserve stored positions. An ambiguous RPC transport failure reports an unconfirmed import outcome rather than claiming no changes; refresh status before retrying.

Plaid acceptance remains incomplete on three activation checks: exact OAuth Dashboard registration has not been verified; a real Sandbox/Production Link-to-holdings run was not authorized/performed; and associated human setup/activation tasks remain pending. This is local implementation readiness, not live provider acceptance.

Official references: [update-mode product consent (explicitly includes Robinhood)](https://plaid.com/docs/link/update-mode/), [Item products and consent](https://plaid.com/docs/api/items/), [Investments API and fields](https://plaid.com/docs/api/products/investments/), [institution eligibility](https://plaid.com/docs/api/institutions/). Robinhood account-specific and crypto coverage must be verified at runtime; public documentation is not proof that this user's accounts will return positions.
