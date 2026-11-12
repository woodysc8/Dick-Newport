# Private Google Docs financial briefing

`/settings/profile` provides read-only **Preview briefing** and explicit **Publish to private Doc** controls. Preview reads saved owner data only, never Google/Plaid. Publish updates a single fixed document using the same budgeting engine as the dashboard. No LLM API is called. No new MCP connector is needed: Claude Desktop can continue reading the same Doc using its existing Google Docs authorization.

Publishing defaults disabled. This release does not create a document, change sharing, configure Google, or publish anything during development. The supported authorization option is a dedicated service account explicitly shared onto a dedicated personal Google Doc. This is not permission to access arbitrary personal Drive files; no domain-wide delegation or impersonation is used. Interactive OAuth/Picker setup is not implemented. If an organization prohibits service-account sharing or file-scoped access fails, publishing stays disabled; do not silently broaden the scope.

## Explicit authorization/setup steps

1. After approving Google setup, create/select a Google Cloud project, enable Docs and Drive APIs, and create a dedicated service account. Grant it no unrelated Drive files or Cloud roles. Keep its private key in the deployment secret store, outside Git/Supabase/browser storage. An organization may prefer workload identity; that adapter is not implemented here.
2. In the explicitly authorized personal Google account, create a **dedicated blank, single-tab, plain-text Google Doc** titled `Richard-Newport / Perfi Daily Financial Briefing`, or select a previously managed briefing Doc. Never point this at a document with unrelated content. The publisher rejects unrelated nonblank documents, tables and multiple tabs.
3. Keep General access **Restricted**. Explicitly share this one Doc as Editor with the service-account email. Keep the owner and necessary Claude-authorized account access. Do not enable public/domain/link sharing. The publisher checks owners, edit capability and permission entries before each write, rejecting unknown readers, groups, domains and public access.
4. Configure these **server-only** variables after approval:
   - `GOOGLE_BRIEFING_ENABLED=true` (leave absent/false until approved).
   - `GOOGLE_BRIEFING_OWNER_USER_ID`: exact authenticated Supabase owner UUID.
   - `GOOGLE_BRIEFING_DOCUMENT_ID`: one fixed document ID, never a browser-supplied target.
   - `GOOGLE_BRIEFING_CLIENT_EMAIL`: dedicated service-account email.
   - `GOOGLE_BRIEFING_PRIVATE_KEY`: PEM private key, real newlines or escaped `\n`.
   - `GOOGLE_BRIEFING_OWNER_EMAIL`: exact document owner email.
   - `GOOGLE_BRIEFING_READER_EMAILS`: optional comma-separated additional explicitly approved individual emails; keep empty if unnecessary. Owner/service account are automatically allowed. This allowlist does not itself grant sharing.
5. Approve/deploy the pending additive migration. Preview in Settings, inspect coverage/classification/freshness warnings, confirm the replacement checkbox, then Publish. Live authorization and write behavior remain unverified until this explicit test.
6. Give Claude the same private document through its existing Google Docs integration and ask it to read the latest briefing, including generated timestamp and provisional/stale warnings. Do not share server credentials or add a new custom connector.

## Safety and operation

OAuth token uses the recommended `drive.file` scope and a short-lived signed service-account assertion. Access tokens are ephemeral in server memory, never persisted/logged/returned. The API makes no document-create or permission-write calls. File-scoped sharing/permission visibility must be verified on the authorized account; failures are closed, not widened to full Drive access. See [Google scopes](https://developers.google.com/workspace/docs/api/auth), [service-account authorization](https://developers.google.com/identity/protocols/oauth2/service-account), and [atomic batchUpdate/write controls](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/batchUpdate).

Preview is bounded to 30,000 characters, 10 recent transactions and 10 large-purchase examples. Long digit sequences/control characters in descriptions are redacted; account numbers/masks, IDs, credentials, tokens and infrastructure details are omitted. Large purchase criteria are transparent: posted USD debit at least $200 this week, not fraud detection. Balances show confirmed-source USD subtotals and incomplete-coverage warnings. Observed income differs from all inflows; profile planned income/recurring expenses are labeled estimates. Missing rent is not inferred. Previous full periods are explicitly compared with partial current periods, without misleading percent trends.

Publish requires an unexpired (15-minute) confirmed preview hash. It reloads the same snapshot/as-of time and rejects changed contents. A service-only durable per-user briefing lease serializes instances. Manual job keys derive from content hashes; scheduled keys derive from NY date. A revision-guarded **single atomic batch** replaces managed text, avoiding a blank partially updated document. Identical document text is a no-op. Up to three HTTP attempts on 429/5xx, bounded exponential backoff and 15-second request timeouts; no raw error body is surfaced. An ambiguous network failure is reported unsuccessful, even if Google committed; a later retry reads the document/revision again. Never claim freshness solely from a failed HTTP response. Google document revision history remains available to its owner.

Settings shows last successful publish and sanitized failure category. The schedule field states the target window; it does not assert that an external scheduler exists. Disable `GOOGLE_BRIEFING_ENABLED` to stop publishing; remove the service-account share and revoke its key after approval to revoke access. Rotate only the Google key in the server secret store, verify a deliberate publish, then revoke the old Google key. Do not rotate the separate Plaid encryption key. Keep document sharing Restricted throughout.
