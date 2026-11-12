# Overview and investment data audit — 2026-11-12

Read-only SQL inspected Dick-Newport-Dev (`oomfxfdtnssaalfqaknz`). No Plaid endpoint was called, no credentials/tokens were read, and no live records or migration history were changed. The separate RLS project was not accessed.

## Why holdings are empty

These are the original read-only findings before the later holdings-consent implementation. See [the current implementation and activation requirements](robinhood-holdings.md); the original combined-refresh importer described below is now replaced by a separate explicit holdings sync.

- Confirmed: three active Items have personal credential references, but every saved `products` array contains only `transactions`. Brokerage, Roth and crypto account records are attached to these transactions-only Items. `investment_holdings` contains zero rows.
- `refreshItem` in `lib/plaidRefresh.ts` always reads accounts, but schedules `refreshHoldings` only when saved products include `investments`. That gate currently prevents holdings import for all three saved connections. Balances can still arrive through `accountsGet`; they do not prove that Investments was enabled.
- If enabled, `refreshHoldings` requires a recognized investment account, calls `investmentsHoldingsGet`, joins security metadata and persists quantity, value, price and cost basis. Unsupported-product responses become warnings; other failures mark the investments stage failed. None of these provider paths were exercised in this audit, so actual provider eligibility or permission has not been verified.
- Link defaults to the transactions product; token exchange stores the selected session product. The older investment-update Link route is disabled. No product flags were changed. Merely editing a database flag would not establish provider authorization. A future separately authorized product-consent/integration pass must enable Investments correctly, preserve existing connections and verify the import before any live refresh.

## Purchase dates and trade history

The app has no `investmentsTransactionsGet` call or investment-transaction table. The stored holdings schema has no acquisition dates or tax lots. Current imports do not retain transaction history or lot acquisition timestamps.

[Plaid Investments](https://plaid.com/docs/investments/) can supply up to 24 months of securities-specific investment transactions, subject to institution coverage. The [API reference](https://plaid.com/docs/api/products/investments/) distinguishes `date` (posting, typically settlement) from institution-dependent `transaction_datetime` (the installed SDK 45 field for order initiation time). A buy record supports a recorded trade event; its posting date is not automatically the original acquisition date for every currently held share. The same reference describes optional holding tax lots with `original_purchase_datetime`; unavailable lot data remains unknown. Transfers-in and older acquisitions can predate the available transaction window. Future import/storage would need separate authorization and schema review; it is not implemented here.

The Investments UI displays **Purchase history unavailable**. Account creation, holding update and balance snapshot timestamps are never presented as purchase dates. Snapshot value changes are no longer labeled investment performance, because they do not isolate deposits/withdrawals or actual returns.

## Monthly exclusion evidence and balances

The read-only audit found 29 outgoing depository rows with exact legacy `Payment > Credit Card` and the Bilt card-payment statement pattern, one corroborated Barclays payment, and 11 outgoing broker-category rows with exact Robinhood statement and merchant metadata (plus four incoming broker credits). These counts cover saved history, not just the current month.

Monthly rules now combine exact legacy category, outgoing depository direction and these narrow descriptions. Fee/reversal/refund conflicts, unsupported directions/accounts, broader broker descriptions, and uncertain Venmo remain unverified; saved overrides and reliable modern metadata take precedence. The spending breakdown separately exposes posted card payments, investment transfers, internal transfers and other supported movements. No categories are persisted or backfilled.

Overview reuses the authenticated monthly endpoint. Connected net worth uses existing account accounting on deduplicated stored account identities, preferring the most recently updated record. Holdings and manual estimates are not added to account balances. Missing/mixed currencies, unknown types and incomplete reads keep totals unavailable. Freshness and unseen duplicate identities remain limitations; no live dashboard behavior was asserted from local fixture tests.
