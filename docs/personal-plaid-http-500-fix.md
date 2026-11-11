# Personal Plaid Save HTTP 500 diagnosis

## Confirmed cause

The local `NEXT_PUBLIC_SITE_URL` setting was present but was not a valid URL. `isSameOriginRequest` evaluated `new URL(configuredOrigin)` for browser-originated mutations and threw before authentication, JSON parsing, encryption, Plaid verification, or Supabase persistence. The credential route converted that configuration exception into a generic HTTP 500 mentioning encryption. GET status skips mutation origin checking, explaining why authenticated GET could succeed while Save failed.

This was reproduced on the running local Next.js server without cookies or credentials:

| Request with a localhost Origin header | Before correcting local configuration | After correction |
| --- | --- | --- |
| GET `/api/plaid/credentials` | 401 JSON | 401 JSON |
| POST `/api/plaid/credentials` with an empty JSON object | 500 generic JSON error | 401 JSON, as expected without a session |

The local ignored `.env.local` site URL was corrected to `http://localhost:3000`. A check confirmed all other environment settings were unchanged. The encryption key already satisfied the application's standard-base64, 32-byte contract; it was not changed. Both Supabase URL and server credentials were configured, and the URL matched the expected project. No environment values other than the non-secret local site address are included here or in the commit.

This diagnoses the current HTTP 500; it does not establish the source of the earlier historical empty HTTP response described in the previous report.

## Verified repairs

- `lib/requestSecurity.ts` now distinguishes invalid site configuration from a mismatched browser origin. It rejects invalid schemes and URLs containing credentials, preserving origin protections without falling back from a configured invalid URL.
- `lib/plaidCredentialConfiguration.ts` defines fixed configuration error codes/messages and a finite set of diagnostic stages. Configured values and original exception causes are never embedded in these messages.
- `app/api/plaid/credentials/route.ts` reports configuration failures as actionable JSON 503 responses. Server diagnostics contain only `stage`, `category`, and HTTP `status`, never raw errors, URLs, request bodies, headers, IDs, or credentials. Stage reporting follows origin validation, authentication, service-client construction, lock acquisition, body validation, credential lookup, encryption, Plaid verification, persistence, revocation, and lock-release failures.
- `lib/plaidCredentialApi.ts` displays only allowlisted, fixed configuration guidance from recognized codes; arbitrary upstream error messages remain suppressed. Refresh status and mutation reconciliation are preserved.
- `lib/plaidCredentials.ts` validates encryption availability before contacting Plaid and persists ciphertext only after successful verification. Invalid/rejected provider requests remain 422; provider outages, transport failures, and timeouts return 503 rather than being treated as invalid credentials. Existing per-user ownership and authenticated context checks are unchanged.
- `lib/plaidOperations.ts` still releases the owner/token-scoped lock on success and failure. It now checks the release result instead of silently ignoring a database cleanup failure. If cleanup fails, the route returns a safe 503 at `lock_release`; Settings can read back committed state without repeating the mutation. A genuinely unreachable database can still require administrator recovery, as documented in the setup guide.
- `lib/plaidTenant.ts` distinguishes missing server Supabase configuration with a fixed 503 error. No global developer-credential fallback was added.

These tracked changes fix verified error classification/diagnostic defects; the immediate environmental cause was repaired only in the ignored local configuration. A deployment with the same malformed setting must correct its own configuration. An HTTP 500 remains reserved for an unexpected application failure, with its sanitized failing stage logged.

## New-account and database checks

Settings, sign-up, sign-in, and the auth callback already initialize profiles through `ensureOwnProfile`. No change to that behavior was necessary. Tests now exercise immediate-session signup initialization, starter Settings with no saved profile, a new authenticated user with no previous credential records, and idempotent profile insertion under actual Postgres owner RLS in the isolated test database.

Read-only live checks on project `oomfxfdtnssaalfqaknz` confirmed:

- RLS enabled for profiles, Items, credentials, and operation locks.
- Authenticated profile INSERT/SELECT permitted with owner-only policies.
- Credential-table SELECT denied to both `anon` and `authenticated` roles.
- Required service-role credential INSERT and operation-lock DELETE permissions.
- Operation-lock RPC available to the service role, denied to browser roles, and security-invoker.
- Credential and operation-lock owners reference Auth users. Items retain the composite credential-owner foreign key and encrypted-token/active-connection constraints.
- REST schema probes requesting **zero rows** succeeded with the service role and were denied anonymously. No secrets or financial records were retrieved.

No live users, profiles, credentials, locks, or financial records were created, updated, deleted, or reset by this task. Fresh-account writes and provider verification were exercised only with mocks and an isolated in-memory Postgres database.

## Migration version mismatch

Read-only remote migration history confirms `20261111213655_personal_plaid_credentials` is applied. The local schema reference remains `supabase/migrations/20261111210821_personal_plaid_credentials.sql`. Neither file identity nor remote history was repaired, and no DDL was reapplied. Do not run a blind `supabase db push` to resolve the timestamp difference. Reconcile history only after a separate schema/SQL review.

## Validation and next step

Regression coverage includes the original invalid-origin 500, safe diagnostics, valid/cross-user credential flows, missing encryption/service configuration, rejected Production access, network/provider failures, persistence failure, lock cleanup, fresh-account profiles, and all previous Save/Verify/Delete UI/parser tests. Logs and response assertions use synthetic fixtures and check that private provider text is not reflected.

The full Vitest suite passed **323 tests**, with the existing opt-in live Supabase RLS suite skipped (35 test files passed). TypeScript, changed-file ESLint, and the production build passed. Full lint retains 31 errors and 21 warnings in unchanged accounting/classification/dashboard code. See the task report for the verified Git SHA.

The observed local origin blocker is resolved. Register/sign into a fresh account, open Settings at the configured origin, and submit the personal credentials only when ready to authorize real Plaid verification. Production product and institution approvals remain external requirements; no real Plaid calls or bank connections were made during this repair.
