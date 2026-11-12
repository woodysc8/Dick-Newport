# Vercel deployment readiness — approval required

Repository must be `woodysc8/Dick-Newport`, branch `feat/personal-plaid-credentials`, remote **dick-newport**. `origin` points to another repository and must never be used for delivery. No deployment, project creation, secret upload, Google configuration, auth redirect update, DNS or live migration is authorized by this document.

The local `.vercel` directory contains repository metadata, but no linked `project.json`. No authenticated Vercel project/plan was available for verification. An existing remote project cannot be ruled out: inspect the correct Vercel team/dashboard read-only before creating anything. Do not create a duplicate project. Check existing Git integration, production branch, preview protection and region/runtime limits after approval.

## Runtime/build

Next.js 16.3, React 19, Node 22.x, TypeScript. Use the lockfile and `npm ci`; build `npm run build`; no static export. Node runtime is required for AES-GCM Plaid decryption, RSA service-account signing, server Supabase auth and cron. API routes use no-store financial responses; protected pages/API verify Supabase identity. Briefing/cron maxDuration is 120 seconds; confirm the actual plan's supported execution budget. Durable locks live in Postgres, not process memory. Existing refresh process coalescing does not replace database leases.

## Environment inventory (names only)

Browser-safe:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: endpoint and publishable key used by `lib/supabase/server.ts`, protected by RLS. This repository requires the PUBLISHABLE_KEY name, not ANON_KEY.
- `NEXT_PUBLIC_SITE_URL`: exact deployed HTTPS origin, also used by server same-origin validation. Use separate correct values per environment.

Server secrets/settings:
- `SUPABASE_SERVICE_ROLE_KEY`: privileged server-only access; never NEXT_PUBLIC.
- `PLAID_CREDENTIAL_ENCRYPTION_KEY`: existing 32-byte AES-256-GCM key, preserve it across deployments. Never generate a replacement for an existing database. Restoring mismatched ciphertext/key makes existing credentials unusable.
- No `PLAID_CLIENT_ID`/`PLAID_SECRET` global developer fallback exists or should be configured. Each owner saves personal Sandbox/Production credentials in Settings; Production/product access is approved on that developer account.
- Existing Plaid redirect/webhook settings, where implemented, must match the selected HTTPS deployment and the owner's Plaid application. Audit current implementation before configuring; this release does not add a webhook endpoint or silently enable a billed refresh product. No automatic live calls are a deployment smoke test.
- Optional Google `GOOGLE_BRIEFING_*` variables are listed in google-docs-financial-briefing.md. Keep all server-only; no plaintext OAuth token database storage.
- Optional scheduling `CRON_SECRET`, `FINANCIAL_JOBS_ENABLED`, `SCHEDULED_FINANCE_ENABLED`, `SCHEDULED_FINANCE_OWNER_USER_ID`, `SCHEDULED_PLAID_SYNC_ENABLED`, `FINANCIAL_SYNC_LOCAL_HOURS`: see scheduled-financial-sync.md. All write-capable integrations default disabled.

Use Vercel encrypted secret storage with separate Development/Preview/Production scopes. Keep previews disconnected from live financial mutation jobs. Never publish .env.local, service keys, Google PEMs, cookies or auth tokens. Google/cron keys can be deliberately rotated in their secret stores then old keys revoked after verification; **Plaid encryption-key rotation requires an explicit re-encryption migration and is not part of deployment**. Preserve per-user developer credentials/Item ownership.

## Approval-gated checklist

1. Verify Vercel team/project and actual plan, correct repository/branch and domain. Read [Cron plan limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) before adding any schedule. No active cron config is committed because the plan is unknown. Hobby cannot provide the requested frequent, punctual dispatcher; use an approved compatible scheduler/plan or manual fallback.
2. Approve/apply only pending reviewed DDL via migration-rollout.md; reconcile known timestamp mismatches deliberately. Never blind db push. Verify owner isolation and preserve $420.
3. Configure only required base server/public variables after approval. Keep all integrations disabled. Verify a production build locally and use the same Node major on Vercel.
4. Set Supabase Auth site URL and exact HTTPS redirect allowlist for the approved domain/preview strategy after approval. Avoid broad wildcards for production. Confirm login/logout, cookie sessions, bearer-auth MCP and unauthorized API rejection on HTTPS. Keep the dashboard behind application authentication.
5. Review Vercel Deployment Protection. It can supplement application auth but may block scheduler invocations. A deployment bypass token never replaces Supabase user authentication or CRON_SECRET. Restrict any scheduler-only exception to the intended protected route/mechanism; do not make financial pages anonymous.
6. Explicitly approve deployment. Verify clean unauthenticated redirects/401s and owner-only read smoke tests first, with no Plaid or Docs writes. Check missing-config states. Review logs for sanitized stages/categories only.
7. Separately authorize one saved-Item sync and one private Doc publish, then scheduler activation. Configure per-user Plaid approved redirect/product settings only with consent. Verify plaintext credentials/access tokens never appear in browser bundles/responses.
8. Monitor last success/error status, missed schedule windows and function duration/quotas. Retain previous deployment for rollback. Roll back code/disable jobs while preserving additive schema, all financial records, credentials, Items, cursor state and manual preferences. See migration-rollout.md.

Live deployment, actual Vercel entitlements, Google file authorization and live provider behavior remain unverified until these explicit steps are authorized. Synthetic tests/build are readiness evidence, not proof of live integration.
