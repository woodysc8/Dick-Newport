# Personal Plaid Settings response fix

## Verified cause and scope

The original Settings component called `response.json()` unconditionally during initial status loading, credential mutations, and recovery status loading. An empty response throws a native `SyntaxError` before the code checks `response.ok`. The mutation catch displayed that exception message directly. This reproduced `Unexpected end of JSON input` in the rendered Settings regression test before the fix.

An unreadable mutation response also left the previous `loaded` flag true if the follow-up status request failed, permitting another operation against unknown state. The new tests reproduced this second failure before the fix.

Unauthenticated HTTP probes against the running local Next.js server returned valid JSON with status 401 for GET, POST, PUT, and DELETE. Before the change, the framework returned empty bodies for OPTIONS (204) and PATCH (405). These observations do **not** prove that either method caused the user's original Save failure: Save uses POST. The source/status of the original authenticated empty response was not captured and remains unconfirmed. No real Plaid calls were made to reproduce it.

## Changes

- `lib/plaidCredentialApi.ts` reads a response body once, handles empty/whitespace/non-JSON/malformed/interrupted/redirected responses, preserves HTTP status in protocol errors, and validates the credential status shape. It returns only safe metadata and never reflects raw upstream bodies or exception messages.
- `app/components/PersonalPlaidCredentials.tsx` uses that contract for loading, Save, Replace, Verify, Delete, and Refresh status. It clears sensitive fields when a mutation starts, serializes UI operations, and aborts an unmounted initial load.
- An ambiguous mutation is never automatically resent. Settings performs one read-only status request to reconcile the result. If that request also fails, all mutation buttons remain disabled until a successful Refresh status.
- `app/api/plaid/credentials/route.ts` explicitly exports management handlers and returns JSON with `Cache-Control: no-store` for controlled success/error paths. Origin-validation exceptions are caught, OPTIONS returns JSON method metadata, and PATCH returns a JSON 405. HEAD has no response body by HTTP definition and is not parsed by the client. Infrastructure failures can still return non-JSON, so client validation remains necessary.
- Existing authentication, user-scoped service-role queries, AES-256-GCM encryption, owner/version binding, and the absence of global developer-credential fallback are preserved.

## Local and remote migration versions

The owner confirmed the following remote application:

| Location | Version |
| --- | --- |
| Local reference file | `supabase/migrations/20261111210821_personal_plaid_credentials.sql` |
| Applied on Dick-Newport-Dev | `20261111213655_personal_plaid_credentials` |
| Supabase project | `oomfxfdtnssaalfqaknz` |

These timestamps describe the same intended feature but are different migration-history identities. **Do not reapply the local DDL or run a blind `supabase db push` to resolve the difference.** The remote tables/RLS and encryption-key configuration were supplied as confirmed context for this fix. No remote DDL, resets, migration-history repairs, or key changes were performed. Exact SQL equivalence and history reconciliation require a separate review before future migration deployment. The local filename and SQL remain unchanged.

## Validation

- Before the fix: all five initial Settings regression tests failed, including the reproduced native JSON parsing exception and the stale loaded-state failure.
- After the fix: full Vitest suite **307 passed, 1 skipped** (34 test files passed). The skipped suite is the existing opt-in live Supabase RLS integration test.
- TypeScript: `tsc --noEmit --incremental false` passed.
- ESLint over all changed feature TypeScript/TSX files passed.
- Repository-wide ESLint ran and still reports **31 errors and 21 warnings** in unchanged accounting, classification, and dashboard code. These unrelated files were not changed.
- Production Next.js build passed. The existing warning about an external `C:\Users\Sam\package-lock.json` remains.
- Mocked HTTP/storage integration tests cover Save, Verify, Replace, Delete, owner isolation, credential encryption, Production access rejection, safe provider errors, and operation contention. DOM tests cover clean status loading, each action, cleared password fields, failed-response recovery, session expiry, and pending deletion. Parser tests cover empty 200/204/405/502 responses, invalid JSON, HTML, invalid success shapes, error-body redaction, redirects, and interrupted reads.

No live credentials, tokens, cookies, encryption-key values, or provider responses were printed. No real Plaid requests or remote database mutations were performed. Real credential verification and the first bank connection still require the owner to use Settings and Plaid Link with their own approved account.

## Using the fixed workflow

Reload `/settings/profile` from the configured site origin. Status should finish loading, with an empty API secret field. Enter the personal developer credentials and matching environment, then Save. Save verifies through Plaid before encrypted persistence; Verify checks saved credentials without returning their values. If the response cannot be read, use the displayed status and Refresh status instead of immediately resubmitting. A `revoking` status requires completing Delete before replacement. Product/institution approval is still checked separately when opening Link.

The publication target is the `dick-newport` remote (`woodysc8/Dick-Newport`), as directed by the owner. The unrelated `origin` remote points to `woodysc8/Richard-Newport` and is not changed or used for publishing this fix. Pre-existing unrelated files `cd`, `codex`, `set`, and `supabase/.temp/` are excluded from the commit.
