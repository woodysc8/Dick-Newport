# Saved Plaid connection refresh repair

## Confirmed causes

The dashboard already sent `fetch('/api/plaid/refresh', { method: 'POST' })`, without JSON or a request body. The server rejected any non-null `request.body`. Next.js 16.3's Node adapter wraps the incoming POST stream even when it contains zero bytes. A regression using the installed `NextRequestAdapter.fromNodeNextRequest` reproduces this representation. Checking stream presence therefore rejected legitimate bodyless requests before credentials or financial sync were reached.

The UI used a single catch for exchange and sync. A successful exchange followed by a refresh error incorrectly said finalization failed and asked users to start again. Repeated exchange also had an unsafe cleanup path: finding an already saved Item threw an error, then `finally` could revoke it through `itemRemove`.

The installed react-plaid-link loader removes its pending script on final unsubscribe. Development Strict Mode can unsubscribe/remount while that script is downloading. Next Script now owns loading and caching; the SDK hook mounts only after loading completes. A jsdom regression uses the actual Next Script and react-plaid-link implementations, simulates script load without network access, and checks one script and at most one active handler through Strict Mode.

## Changes

- Accept a zero-byte stream; cancel and reject at the first actual body byte, including `{}`. Keep a bodyless client POST, authentication, same-origin validation, and operation locks.
- Keep exchange success visible when sync fails. Add **Refresh saved connections**, available on a fresh dashboard without opening Link. Guard duplicate token requests, opening, success callbacks, and refresh actions.
- Repeated finalization returns success for the same owner and credential record, preserving its encrypted token. Conflicts never overwrite or revoke an existing Item. Cleanup of a newly exchanged unsaved Item checks again for a saved row and fails closed on lookup errors.
- Return fixed refresh stage/category diagnostics and actionable known operation/configuration errors. Item failures identify only ownership, token decryption, accounts, transactions, or investments. Logs contain fixed stage/category values, without provider objects, IDs, tokens, or financial data.
- Preserve the existing transaction cursor, idempotent persistence, owner filters, encryption bindings, and partial sync behavior. Completed refreshes update the dashboard even if some Items failed.

## Read-only database observation

On 2026-11-11, aggregate queries showed **3 active transactions-enabled Items**, **0 accounts**, **0 transactions**, **1 profile**, and **0 operation locks**. Every Item's credential record matched its user. This differs from the earlier report of two Items; no Item was deleted, recreated, decrypted, or sent to Plaid during this repair. Aggregate checks cannot determine whether different Items represent the same bank.

## Retry without reconnecting

1. Restart the application with the updated code and reload the dashboard.
2. Sign in as the owner of the existing connections.
3. When ready to authorize live Plaid requests, click **Refresh saved connections** once. This refreshes all active saved Items for that user without opening Link or exchanging tokens.
4. Wait for completion. The dashboard shows imported balances and transaction changes; partial errors identify the failed stages. Retry refresh after resolving temporary or product access problems.
5. A credential-loading error requires checking personal credential status in Settings. A token-decryption error requires checking the existing server key; do not rotate it. A lock-release error requires administrator investigation rather than reconnecting.

Do not click Connect a bank again merely because initial sync failed. Do not automatically remove potentially duplicate saved Items. Live product entitlements, institution availability, and the first account/transaction import remain unverified because no live Plaid calls were authorized.

## Validation and migration safety

Tests use synthetic credentials, mock providers, disposable in-memory storage/Postgres, and simulated SDK load events. The opt-in live RLS integration test remains skipped. No live Plaid requests or database writes were made.

Final results: **336 tests passed, 1 opt-in live RLS test skipped**. `tsc --noEmit`, changed-file ESLint, and `npm run build` passed. Full repository ESLint reports **31 errors and 21 warnings**, all in unchanged accounting, transaction classification, dashboard, and classification utility files. The build also retains the existing warning about an ignored package-lock outside the repository.

The previously applied remote migration is `20261111213655_personal_plaid_credentials`; the local migration is `20261111210821_personal_plaid_credentials.sql`. This repair changes neither schema nor migration history. Do not run `supabase db push` to resolve the timestamp difference.
