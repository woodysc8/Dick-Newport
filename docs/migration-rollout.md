# Explicit migration rollout and rollback

**Nothing in this release applies live DDL, backfills transactions, repairs migration history or changes the existing $420.** The separate RLS project `bzfssrtdrqtqirfkwakf` is prohibited and was not contacted. Automated PostgreSQL tests use in-memory PGlite only.

Pending additive migration: `supabase/migrations/20261112020000_budget_briefing_jobs.sql`.

Creates category/account rules, independent monthly limit settings, preference audit, private durable job runs and owner-readable safe job status. Adds monthly transaction inclusion override and extra normalized categories. Extends pending-to-posted preference inheritance. Adds bounded owner-safe financial snapshot and service-only explicitly owner-scoped scheduled snapshot/claim/finish RPCs; updates weekly snapshot to reuse shared rules. Functions are SECURITY INVOKER with explicit search paths and grants. Jobs cannot be claimed/finished or scheduled snapshots read by browser roles. Foreign keys preserve owner boundaries and cascade only if an existing owning profile/account is deliberately deleted; this migration deletes nothing.

## Known history mismatch — do not blindly push

Read-only Dev metadata audit found:

| Local file | Already applied remote version |
| --- | --- |
| `20261111210821_personal_plaid_credentials.sql` | `20261111213655_personal_plaid_credentials` |
| `20261112010000_transactions_weekly_budget.sql` | `20261111230806_transactions_weekly_budget` |

The approved weekly schema exists in Dev and its one existing weekly limit was verified as $420 without printing transaction details. Do not replay either file because its filename differs. Do not run `supabase db push`, migration repair, reset, seed, truncate, deletes or a database reset. Do not rename/replace historical files to hide this mismatch.

## Approval-gated procedure

1. Verify repository/branch/remote and capture the current deployed code SHA. Review this pending migration and the existing remote schema/history side by side using read-only metadata. Confirm owner RLS and existing weekly functions match the approved baseline; investigate drift rather than replay old DDL.
2. Obtain explicit approval for **this exact new file only** against the intended Dev project. Obtain a separate approval if production is a different project. Arrange an administrator-controlled backup/restore point and maintenance window. Export settings/count checks privately; never dump financial records/secrets into the agent transcript.
3. Re-run disposable migration/RLS tests and review CHECK/FK/grant behavior. This file is idempotent; tests apply it twice while preserving $420/manual categories. Do not infer live validation from synthetic tests.
4. Have the authorized administrator apply only the reviewed new SQL in its transaction and record version `20261112020000` through an approved migration mechanism that does **not** replay mismatched historical files. If a history reconciliation is needed for tooling, treat that as a separate reviewed operation with its own approval; none is supplied/executed automatically here.
5. Read-only verify: new tables have RLS, browser has no job run/claim/scheduled-snapshot access, safe status is owner-only, preference indexes/grants and snapshot ranges are correct, original record counts and existing $420/manual edits remain unchanged. Verify current app user's GET endpoints before any preference writes.
6. Deploy matching reviewed code only after separate Vercel approval. The enhanced transaction query requires the new monthly override column; deploy schema **before** activating this code in a running environment. Missing schema returns actionable unavailable states, never fabricated totals.
7. Leave scheduling and Google publishing disabled. Preview classifications without writes. Any automatic historical backfill is separately approval-gated; user-confirmed category corrections are ordinary explicit owner actions, audited and atomic.
8. After separate approvals, authorize a mock-free owner test of manual saved-Item refresh, then one private Doc publish. Enable tracking and scheduling only after those succeed and costs/platform limits are accepted.

## Rollback

First disable `SCHEDULED_FINANCE_ENABLED`, `SCHEDULED_PLAID_SYNC_ENABLED`, `GOOGLE_BRIEFING_ENABLED` and `FINANCIAL_JOBS_ENABLED`, and disable the external/platform trigger after approval. Revert application deployment to its last reviewed SHA. Keep additive tables/columns/audit/history intact; old code ignores them. Do not drop monthly overrides or undo user corrections, reset cursors, rotate Plaid keys, delete Items or restore a whole database over newer financial activity. A destructive schema rollback is deliberately not automated. If necessary, an administrator can review a targeted function rollback based on the previous migration, with explicit approval and backup; preserve pending preferences and financial records.

## Validation evidence

Synthetic tests cover two owners, atomic cross-user review rejection, CHECK constraints, $420 preservation, monthly pending preference inheritance, safe snapshots, service-only job RPCs, concurrent-key exclusion, token-checked finish and daily ceilings. Existing credential migration tests also replay the new file. No live RLS test was run against Dev or the prohibited test project. Final test/build/lint results are recorded in the delivery report; live Google, scheduler and Plaid acceptance remain approval-gated.
