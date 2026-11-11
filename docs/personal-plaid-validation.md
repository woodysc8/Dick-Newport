# Personal Plaid implementation validation

This is the initial implementation report. For the subsequent **307 passing tests**, Settings response fix, and the owner's confirmed remote migration application, see [Personal Plaid Settings response fix](personal-plaid-save-verify-fix.md). The pending-migration statements below describe the initial implementation state.

Validated locally on November 11, 2026, using Node 22.23.1 on Windows cmd, on `feat/personal-plaid-credentials`. The original `plaid-redesign-checkpoint` branch was not changed. No hosted migration or deployment was performed.

## Architecture and migration review

- The original application configured one global Plaid SDK client. Link, exchange, and refresh now load only the authenticated user's encrypted credential record; there is no global fallback.
- The four existing migrations were inspected and replayed in order before the new migration in an isolated in-memory Postgres database. Existing migrations already duplicate sync/snapshot columns with `IF NOT EXISTS`; these replay successfully.
- Legacy Items have no reliable personal credential attribution. They become `reconnect_required`, and their plaintext tokens are cleared. Revoke them in the former developer Dashboard **before** manually applying the migration.
- The previous snapshot schema required `portfolio_value NOT NULL` even though missing provider balances are valid. The new migration allows null values.
- New constraints enforce credential ownership and require active Items to have a credential reference and encrypted token. Browser roles cannot read credentials, tokens, or operation locks.
- Link/exchange tests for the previous global architecture were consolidated into `lib/personalPlaid.integration.test.ts`, which exercises the HTTP handlers, actual credential/encryption utilities, branded authentication contexts, and mocked storage/provider boundaries.

## Results

| Check | Result |
| --- | --- |
| TypeScript, `tsc --noEmit` | Passed |
| Full Vitest suite | 279 passed, 1 skipped; 31 test files passed |
| Migration replay and SQL role/constraint checks | Passed on isolated PGlite Postgres |
| Next.js production build | Passed |
| ESLint over changed TypeScript/TSX files | Passed |
| Repository-wide ESLint | Failed: 31 errors and 21 warnings in unchanged files |
| Live Supabase Auth/REST RLS suite | Skipped; disposable target/users were not configured |
| Real Plaid Sandbox/Production flows | Not run; no personal developer credentials were used |

Tests cover two different users/clients/environments, cross-user and forged-context rejection, randomized authenticated encryption, owner/version/environment binding, wrong keys, malformed ciphertext, saved verification, Production access rejection, unsupported investment access, stale Link sessions, revocation/replacement and retry behavior, failed Item persistence cleanup, operation contention, unauthenticated requests, body limits, cross-origin protection, null balances, historical data preservation, and existing dashboard/profile behavior.

## Remaining issues and operational limits

1. The migration must be reviewed and applied manually after legacy remote revocation. Set and protect `PLAID_CREDENTIAL_ENCRYPTION_KEY` before using the new endpoints. Existing hosted schema drift was not inspected or changed.
2. Live Supabase Auth/REST isolation and real Plaid approval, consent, and revocation still require a disposable environment and each owner's developer account. In-memory SQL tests validate migrations and database grants/constraints, but not hosted API configuration.
3. Repository-wide lint errors remain in unchanged `app/api/accounting/audit/route.ts`, `app/api/transactions/classify/route.ts`, `lib/accounting.ts`, and `lib/classifyTransaction.ts`. Existing unused-code warnings also remain in `app/page.tsx` and `lib/classifyTransaction.ts`.
4. The package install reported 28 npm audit findings (13 moderate, 11 high, 4 critical) across the dependency tree. No broad dependency upgrades or automatic audit fixes were performed.
5. Crashed operations retain a lock until administrator recovery, intentionally preventing unsafe concurrent rotation. Server encryption-key rotation requires an offline procedure. See the setup guide.
6. Reconnecting preserves old history but does not merge old and new Plaid account identities automatically. Review duplicate historical/new accounts before comparing totals.
7. Simultaneous database persistence and Plaid cleanup failures can leave an untracked remote Item requiring removal in the owner's Plaid Dashboard.
8. Next.js reports an existing package-lock outside the Git repository and ignores it. The application build still succeeds. Docker's engine was unavailable; SQL checks used isolated PGlite instead.

See [family setup and administrator recovery](personal-plaid-setup.md) for the deployment prerequisites and operating instructions.
