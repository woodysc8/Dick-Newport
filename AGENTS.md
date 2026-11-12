<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Targeted validation

- Default: run tests for changed modules and affected shared calculations once, `npx tsc --noEmit` for TypeScript changes, and `npx eslint <changed files>`. `npm run test:fast` is the dashboard/briefing subset; narrow it further when appropriate.
- Shared financial logic: also run `npm run test:financial` (budget, categorization, pending replacements, duplicates, owner authorization, and briefing redaction). These tests use local fixtures, not live services.
- Run `npm run build` once at the end when imports, routing, server/client boundaries or deployment behavior may be affected.
- Reserve `npm run test:all` for migrations, auth/RLS architecture, Plaid synchronization, major engine rewrites, or explicit release readiness. Run it once at the end. Never enable live RLS tests without separate authorization.
- Do not delete tests to improve speed. Rerun only tests affected by subsequent changes or failures.
