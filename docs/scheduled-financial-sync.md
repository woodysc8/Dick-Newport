# Scheduled financial sync and daily briefing

Implemented dispatcher: `GET /api/cron/financial`; protected by exact bearer `CRON_SECRET` using SHA-256 fixed-length constant-time comparison. No URL secret fallback or anonymous job mutation. The dispatcher verifies an explicit configured owner still exists and is not banned through server-side Supabase admin access, then creates the existing branded per-user Plaid context. No arbitrary owner request parameter is accepted. Credentials stay encrypted/per-user; existing Items are refreshed without Link/public-token exchange.

## Activation gates and variables

Everything defaults off. First approve/review the migration, deployment plan, provider entitlements/costs, Google authorization and real Plaid test separately. Server-only variables:

- `FINANCIAL_JOBS_ENABLED=true`: enable durable attempt/status tracking and limits on the existing owner-authenticated manual `/api/plaid/refresh`. Leave false until migration approval. Without it, existing manual refresh remains operational but historical freshness is unrecorded.
- `SCHEDULED_FINANCE_ENABLED=true`: explicit dispatcher owner delegation. Leave false until scheduler approved.
- `SCHEDULED_FINANCE_OWNER_USER_ID`: exact single consenting Supabase owner UUID. This deployment supports one scheduled owner, not automatic scheduling of all users.
- `SCHEDULED_PLAID_SYNC_ENABLED=true`: separate explicit permission to refresh saved Items on scheduled invocations. This is not enabled by code or tests.
- `FINANCIAL_SYNC_LOCAL_HOURS=0,6,12,18`: four distinct integer local hours; configurable. Invalid configuration fails closed.
- `CRON_SECRET`: cryptographically random value at least 32 characters in server/scheduler secret stores, sent only as `Authorization: Bearer ...` over HTTPS. Never put in URLs, source control or logs.
- Google variables from google-docs-financial-briefing.md for scheduled publishing.

## DST-aware timing and platform limits

Target four sync **attempts**, not guaranteed provider data changes. Default local windows 00:00–00:29, 06:00–06:29, 12:00–12:29, 18:00–18:29. Briefing window 06:30–06:59 America/New_York, so normal 15-minute triggering gives 06:30 and 06:45 opportunities before 07:00. Keys include local date/hour; DST repeated times cannot duplicate a successful key. Spring-forward missing custom hours are skipped; defaults avoid 02:00. Invalid/late invocations skip work, never pretend a 07:00 success. Provider/network outages and scheduler latency prevent a punctuality guarantee.

Current [official Vercel legacy Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), reviewed 2026-11-11: Hobby permits once-daily cadence per job with execution within the scheduled hour; Pro/Enterprise support minute-level cadence/precision. The documentation also announces newer Schedules with timezone support. Actual account plan/project and newer Schedules entitlements have **not** been verified; local `.vercel` metadata does not establish an active cloud project or plan.

No active vercel.json cron is added. After explicit plan verification/approval, Pro or a compatible authenticated external scheduler can trigger this dispatcher every 15 minutes in UTC (`*/15 * * * *`), letting Intl select New York windows. Do not install this cadence on Hobby. A user-approved external scheduler can call the same HTTPS route with the bearer header; verify reliability, plan/runtime terms and Deployment Protection compatibility first. A daily Hobby fallback cannot promise four distributed attempts or by-07:00 delivery: use manual refresh/publish and clearly label stale content, or approve a capable scheduler/plan. Do not evade plan limits with duplicate daily cron entries.

## Locks, limits and failure recovery

Service-only invoker RPCs use transaction advisory locks to serialize claims across serverless instances. Durable per-owner/kind leases expire after 15 minutes (longer than route maxDuration 120 seconds). Completed keys cannot repeat; failed/expired keys have at most three attempts. Fifteen-minute per-kind cooldown and at most four sync attempts per NY day, including retries and tracked manual refreshes, prevent storms. Manual refresh may consume the daily allowance and prevent a later scheduled slot; the target is a ceiling, not four guaranteed successes. Job tables record sanitized categories/timestamps, no financial payloads. Browser can read only its safe status rows, not lease tokens/run internals.

Existing per-user Plaid credential operation lock and profile sync lease remain authoritative; do not clear them automatically. If a process dies while holding the older credential operation lock, an administrator must diagnose the stale lock read-only and obtain approval for targeted recovery; no broad lock deletion is implemented. Runtime must enforce maxDuration; do not run unbounded long-lived job workers with these lease assumptions. Cursor advances only after terminal buffered pages and checked persistence. Partial data writes replay idempotently on retry; data snapshot refuses totals during an active import. Sync errors never revoke/recreate Items or overwrite manual categorization.

Refresh uses existing Accounts/Transactions Sync and entitled Investments flows, not a new billed `/transactions/refresh` request. Plaid institution update cadence and entitlements still apply; four calls do not promise four new bank updates. Confirm product permissions, rate limits and costs with the owner's developer account before activation. A failed sync leaves previous verified data available; briefing explicitly identifies stale/unrecorded last success. If an import is still active, publishing fails closed and retries in a later eligible window rather than exporting mixed totals.

Manual retry paths: Overview's existing Refresh saved connections (owner authentication/same origin; tracking flag controls new job limits), and Settings Preview → confirmed Publish. Neither reconnects banks. Use safe status timestamps/categories to diagnose a failure; do not paste provider raw responses/tokens into logs. Monitor missed windows externally after scheduler approval. No webhook configuration or live provider calls were performed in this implementation.
