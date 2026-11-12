# Transactions and weekly-budget integration review

Scope: existing Dick-Newport per-user credentials and saved Items; stored transaction browsing and weekly budgeting. User confirmed the guided workflow, existing authentication only, and existing transactions/investments/liabilities data scope. No new verification, money movement, products, paid add-ons, live calls or connection lifecycle changes are authorized by this task.

Decisions made:
- Keep current Link product configuration and per-user encryption architecture. Shared environment credentials, new product consent and reconnecting Items are rejected as unnecessary and contrary to scope. GUIDE-001/002/003/004/006 apply through the existing per-user server credential store; no global CLI credential setup is appropriate.
- Use the existing authenticated server and transaction table; new user-scoped APIs expose only safe financial fields. GUIDE-003, DATA-001.
- Preserve modern PFC primary/detailed/confidence separately, pin v2 on existing sync calls, auto-classify only HIGH/VERY_HIGH. TXN-005/006/013.
- Buffer a bounded complete update and restart from the original Item cursor on pagination mutation. Save only the terminal cursor after persistence; use idempotent replay on persistence failure. TXN-002/004/007/011. Atomic data-plus-cursor persistence remains a documented limitation.
- Preserve explicit pending-to-posted user decisions with an owner/account-bound insert trigger, process all additions/modifications before removals, and retain owner/provider identities. TXN-004.
- Prefer persistent account identity; require explicit source review when identity is unavailable. Never fuzzy-delete matching purchases. TXN-012.
- No automatic freshness polling or new webhook receiver is introduced. Reads use already-synced data. User-triggered saved-connection refresh stays the existing path; no separately billed transactions/refresh calls. TXN-008/010, GUIDE-016.

Verified human tasks / deployment gates:
- Remote migration history inspected read-only: the credential migration timestamp differs locally/remotely. Administrator review is required before any history reconciliation; none performed.
- New additive migration tested on disposable PostgreSQL; remote deployment pending explicit approval.
- No new Dashboard configuration is needed for stored-data browsing. Existing account-level production access and institution availability are not revalidated without live-call authorization.
- Live Sandbox/Production Link→exchange→sync smoke tests are not run; the user prohibited unnecessary live calls. Existing update-mode/webhook/OAuth production validation gaps are unchanged and outside this repair.
- After approved migration deployment, choose exactly one weekly budget source per underlying account, configure the limit, and authorize a saved-connection refresh only if imports are missing.

Acceptance evidence: unit/API/UI tests and disposable RLS/migration tests; TypeScript, ESLint and production build; unauthenticated HTTP smoke checks. Final evidence and unresolved deployment gates are recorded in docs/transactions-weekly-budget.md and the delivery report. This plan does not claim live Plaid acceptance.

## Budget engine / briefing release

The user explicitly requested four daily saved-Item refresh attempts, subject to approval and platform/provider limits. This is an accepted scheduled polling design, not a hidden browser polling loop. All scheduling and Google write paths default disabled. Existing authentication and per-user encrypted Plaid credentials remain the authority; no new connector, verification product, global fallback or connection reset.

Human tasks: pending additive migration approval (documented timestamp mismatches); actual Vercel project/plan verification; explicit owner delegation and cost/entitlement acceptance; Google dedicated-file authorization and private sharing; authorized live Sandbox/Production sync test; one approved private Doc publish; scheduler activation/monitoring. These tasks are deliberately unverified and reported as activation blockers, not marked completed. WEBHOOK-005: before expanding beyond the approved single-owner polling stopgap, review a verified, idempotent SYNC_UPDATES_AVAILABLE webhook design and migration plan. No webhook receiver is added or claimed tested in this release.

New classification tests cover different synthetic personas, including $420 with $527.26 unreviewed (provisional, conservative −$107.26) and groceries included/rent excluded weekly with independent monthly obligations. Original provider fields/manual overrides and cursor semantics are preserved. The private briefing uses stored snapshots, never an LLM or a new paid Plaid refresh product. Final mocked/disposable test counts and HTTP smoke evidence appear in docs/financial-engine-validation.md; live CHECK-008 remains unfulfilled because live Plaid calls are prohibited during this task.

## Holdings consent and import (current task)

Scope: existing Dick-Newport Next.js/TypeScript app; Investments only. The user declined the guided workflow earlier and authorized direct tool use. No trades, transfers, withdrawals, transaction refresh, live holdings import, migration application or deployment during development.

Decisions made: reuse the disabled investment-update Link route, add `/api/plaid/holdings` for stored status/verification/explicit sync, use owner-scoped internal connection UUIDs, and add account status fields plus a service-only atomic RPC. The user approved local schema/RPC implementation after reviewing `docs/robinhood-holdings.md`; applying it is not approved. No new tables or dependencies.

Rules reviewed: GUIDE-001/002/003/004/005/006/010/011/014/015/017/020; ITEM-001/002/003/006/008; DATA-001/002/003/004; INV-001/002/005/006/007/009/010/012/013/015; PITFALL-001/002/004/005. Access tokens and personal credential decryption remain server-only. Update mode adds Investments through additional_consented_products, verifies Item products after Link, and never exchanges/rotates an existing Item. Separate connections are explicit and may add billing/overlap. Positions join only securities in the same response. No automatic refresh, polling, history inference or webhook dependency is introduced.

Validation: focused consent/authorization/import/isolation/UI/report tests, in-memory PGlite transaction rollback and permission checks, TypeScript, changed-file lint, full local suite once because synchronization/schema changed, production build once, and local unauthenticated route smoke requests. Provider calls in unit/integration tests are mocks, not a live Sandbox or Production run.

Human tasks: local implementation approved; migration application pending separate approval. Product entitlement, environment, DTM use case/customization, OAuth registration and exact redirect URI are unverified production setup. Robinhood's documented update-mode product-consent requirement is established, but the user's institution/account/crypto coverage is unverified. Live/Sandbox Link-to-holdings acceptance is deferred because the user has not approved a live holdings sync. First user actions after approved schema/deployment: Enable holdings, grant consent, then explicitly Sync holdings. No deployment or active schedule is included.

Final local evidence: full suite 644 passed / hosted RLS skipped; final focused page checks 6 passed and consent/import checks 16 passed; TypeScript, changed-file ESLint, production build and real unauthenticated route smoke checks passed. Final Plaid acceptance reports CHECK-007/008/009 unfulfilled because OAuth registration, real end-to-end execution and activation tasks remain unverified, not because live work was attempted. No live integration acceptance is claimed. See docs/robinhood-holdings.md.
