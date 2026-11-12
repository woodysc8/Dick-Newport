# Financial Report: approval proposal

Status: local schema and scheduler implementation approved in this session. Applying the migration, production writes, job activation and deployment are not authorized.

The existing `/reports` placeholder will become **Financial Report**, using authenticated owner-scoped reads. A deterministic report will reuse connected-position and monthly-activity calculations. DOCX/PDF exports will contain the same frozen report content. Generating a report never calls Plaid or refreshes a bank connection.

## Changes requiring approval before implementation

1. Add a private `financial_report_snapshots` table: UUID primary key, authenticated owner UUID, generated timestamp, schema version, report JSON, optional schedule key. An owner/schedule-key unique constraint prevents duplicate scheduled snapshots. Store safe display data only, without account numbers, provider identifiers, credentials, or raw transactions. Enable RLS; owners can read and insert their own snapshots. No authenticated update/delete permission; reject updates with a database trigger so saved contents stay unchanged. No public storage or public download URLs.
2. Add `financial_report_preferences`: owner primary key, weekly/monthly opt-in flags defaulting to false, updated timestamp. Owner-only read/write RLS. The Update report button inserts a new immutable snapshot; historical downloads render the saved JSON without rereading financial records.
3. Add a separate authenticated report scheduler endpoint using the existing constant-time CRON_SECRET verification. It reads only explicitly opted-in owners, generates Monday weekly and first-day monthly snapshots in America/New_York, and uses distinct per-owner calendar schedule keys. A failed run can be retried without duplicating completed snapshots. It never imports or invokes the Plaid synchronization workflow. Local mocked scheduling and RLS tests will cover isolation and retries.

Approval of implementation means local migration files, application code, and tests only. Applying migrations, production writes, setting environment variables, adding an active Vercel cron configuration, or deploying still requires separate approval. The existing migration timestamp mismatch will not be repaired. The separate RLS test project will not be accessed.

## Report content and limits

Account balances determine net worth; holdings are displayed separately and never added again. Monthly posted purchases, unverified debits, pending amounts, and excluded movements use the existing monthly activity engine. Incoming amounts are not automatically labeled income. Configured income/debt information is labeled as estimates/manual data and never added to connected balances. Missing data remains unavailable rather than zero.

Each snapshot records generation time separately from stored source-update observations. Missing or unverified bank-sync freshness is explicit. Net-worth changes require comparable currency and account coverage, and are never described as investment returns. Purchase history remains unavailable until actual trade/tax-lot records exist. Bound account, holding, and recent-transaction sections; fail explicitly on incomplete aggregate reads rather than publishing definitive partial totals.

Until storage approval and activation, the page can offer a read-only generated preview and downloads, clearly labeled unsaved. Historical comparisons and schedules remain unavailable rather than simulated.

## Activation checklist (separate approval required)

The local migration is `supabase/migrations/20261112200000_financial_reports.sql`. Do not use an indiscriminate `db push`: first account for the pre-existing local `20261112020000` / remote `20261112161751` migration timestamp mismatch. No history repair is included here.

After the migration is explicitly approved and applied, `FINANCIAL_REPORT_STORAGE_ENABLED=true` enables new snapshot and preference writes. `FINANCIAL_REPORT_SCHEDULE_ENABLED=true` additionally enables the separate `/api/cron/financial-report` route. Both are false by default. Cron requires a server-only CRON_SECRET of at least 32 characters and the existing server-only Supabase service-role credential. Interactive report requests use the authenticated owner client, never that credential.

Only after separate scheduling/deployment approval, configure a daily `0 14 * * *` Vercel cron to that route. The route evaluates the New York calendar, so this runs during the local morning through DST changes. Only opted-in Monday/first-day slots write snapshots. First-day snapshots report the previous calendar month's spending and generation-time account balances, not invented month-end balances. Unique per-owner keys prevent duplicate successful snapshots; failed work returns 503 and can be retried the same local day. Uncompleted slots are not automatically backfilled on a later day. Opt-in preferences default to false. The scheduler bounds the opted-in owner scan at 500 and refuses incomplete scans; this is deliberately a small-app implementation.

No active cron entry is added to vercel.json. All existing sync/briefing jobs and financial tables are unchanged. DOCX/PDF files are generated locally in the authenticated browser from the displayed frozen report. Downloads contain no snapshot/account/provider identifiers; the private snapshot ID is used only to select history. The report format is versioned, and historical exports never run current calculations. PDF characters outside the built-in font are represented explicitly as Unicode code points rather than silently removed; DOCX preserves original Unicode text.

Focused validation command: `npm run test:reports`. Shared connected-position, monthly-activity and financial-planning tests should also run when their report integration changes. This migration warrants one full local suite at the end. Hosted RLS tests are not authorized; the new policies are exercised with in-memory PGlite.
