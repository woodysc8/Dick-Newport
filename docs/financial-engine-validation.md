# Financial engine release validation

Date: 2026-11-11. Baseline branch `feat/personal-plaid-credentials`, baseline SHA `63de136e45b19780d0076e8b4e05a9968f2be434`. Delivery remote verified as `dick-newport` → `https://github.com/woodysc8/Dick-Newport.git`; unrelated origin was not used. Existing untracked `cd`, `codex`, `set`, `supabase/.temp/` were preserved/excluded.

## Verified checks

- TypeScript `tsc --noEmit`: passed.
  Run after the build, not concurrently: Next regenerates route type files during build, which can transiently invalidate a simultaneous standalone typecheck.
- Full Vitest: **490 passed, 1 opt-in live RLS test skipped**, 49 passing test files. All new provider/Google tests use mocks; all migration/RLS tests use disposable in-memory PGlite. No live database financial writes or real provider calls.
- Changed-file ESLint: **0 errors**, 20 existing warnings in `app/page.tsx`; no new warnings. Full ESLint remains **31 pre-existing errors, 21 warnings**, located in `app/api/accounting/audit/route.ts`, `app/api/transactions/classify/route.ts`, `lib/accounting.ts`, `lib/classifyTransaction.ts`, `app/page.tsx`.
- Optimized Next.js 16.3 production build: passed with Node 22.23.1. Validation uses `PERFI_BUILD_VALIDATION=1` / `.next-validation`, preserving the running local `.next` output. This output is ignored by Git/ESLint; TypeScript includes generated validation route types. Existing warning: an unrelated parent-directory package-lock is ignored by Next. No new runtime/build error.
- Final production HTTP smoke on temporary port 3108: server booted; **9 API method/path checks returned JSON 401** without authentication; **4 protected pages redirected to login without financial content**. Next may stream the Transactions redirect in a 200 response; redirect metadata and absence of protected UI were checked. Temporary server stopped; existing localhost:3000 service preserved.
- Local environment presence verified without printing values: Supabase URL/publishable/service-role settings exist; existing Plaid encryption key decodes to 32 bytes. Google publishing and scheduling remain disabled. No linked local Vercel project file; actual remote team/project/plan unverified.
- Read-only Dev migration metadata confirmed existing approved weekly schema, known credential/weekly timestamp mismatches, and persisted $420. No transaction ledger details were printed. The separate prohibited RLS project was not contacted.

## Regression coverage

Classification provenance/priority, Bagel Express, ambiguous Walgreens/Payment, groceries/rent defaults, protected movements, monthly/weekly rules and caps, individual overrides, conservative $420/$527.26 status, currencies, partial/empty data, explicit zero/unset limits, DST/month boundaries, pending preference inheritance, durable-source duplicates without fuzzy deletion, owner isolation, atomic confirmed review, sanitized APIs, malformed UI responses, private Doc scope/privacy/revision/bounded retries/idempotency, constant-time cron secret matching, explicit delegated owner/banned-user checks, durable claims/token-checked finishes/cooldowns/daily ceilings, disabled states, existing monthly planning/dashboard/Plaid tests.

## Unverified activation / acceptance

Plaid MCP acceptance reports **CHECK-008 failed** (live Sandbox Link → exchange → product test prohibited) and **CHECK-009 failed** (external human activation tasks intentionally pending). This is not a live-ready integration claim. Existing update-mode/OAuth/webhook production validation gaps remain; scheduling is an explicitly requested polling stopgap with WEBHOOK-005 documented in PLAID_PLAN.md.

Pending explicit approval: apply only `20261112020000_budget_briefing_jobs.sql` through the reviewed rollout; any live historical backfill; Google account/file authorization and one private publish; actual Vercel project/plan/secrets/redirects/deployment; authorized real Plaid sync; scheduler activation and monitoring. Enhanced transaction reads require the new monthly override column/policy RPC, so deploy the schema before activating matching code. Missing schema produces unavailable states, never fabricated zeros. No automatic migration/history repair is safe given the known timestamp mismatches.

Known limitations: stored-category transaction filtering may differ from newly derived classifications until explicit corrections/backfill; dry run is bounded to current/previous month/week and 50 examples; no interactive Google OAuth/Picker or workload-identity adapter; dedicated plain-text single-tab document only; single configured scheduled owner; actual external schedule/punctuality unknown; no automatic refund matching, FX conversion or fuzzy duplicate deletion; existing credential operation-lock crash recovery requires targeted administrator review/approval; original sync data writes plus cursor are replay-safe but not a single database transaction. Full activation and by-07:00 delivery cannot be certified without the approval-gated live checks.

See budget-engine.md, google-docs-financial-briefing.md, scheduled-financial-sync.md, vercel-deployment.md and migration-rollout.md for configuration, activation and rollback.
