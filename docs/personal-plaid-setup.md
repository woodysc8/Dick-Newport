# Personal Plaid setup

Each family member signs into their own Dick-Newport user account and supplies credentials from their own Plaid developer account. There is no shared developer account or global credential fallback.

For the latest Save/Verify response fix and the confirmed **remote migration version mismatch**, see [Settings fix and migration history](personal-plaid-save-verify-fix.md). Dick-Newport-Dev already has the feature applied as `20261111213655_personal_plaid_credentials`; do not reapply the local `20261111210821` DDL there.

## Administrator setup

1. Review `supabase/migrations/20261111210821_personal_plaid_credentials.sql` as the local schema reference. Dick-Newport-Dev already has the feature applied under the remote version above. For a different target, back up the database and review its schema and migration history before any manual application; never treat the local timestamp mismatch as permission to reapply it.
2. Before applying the migration, revoke legacy connections from the former developer account's Plaid Dashboard. Legacy Items cannot be attributed to personal developer credentials. The migration clears their old plaintext access tokens and marks them `reconnect_required`. It preserves accounts, transactions, holdings, snapshots, budgets, goals, and profiles.
3. Generate one random 32-byte encryption key, encode it as standard base64, and store it in your hosting secret manager as `PLAID_CREDENTIAL_ENCRYPTION_KEY`. Keep it outside Supabase and Git, with a separately protected backup. All application instances must use the same key. Do not use a `NEXT_PUBLIC_` name.
4. For local development, the key can be supplied through an ignored `.env.local` file or the process environment. From cmd, a key can be generated into a file outside this repository without printing it into chat or terminal history:

   ```cmd
   set "PATH=C:\Users\Sam\node-portable\node-v22.23.1-win-x64;%PATH%"
   node -e "require('fs').writeFileSync(require('path').join(process.env.USERPROFILE,'.dick-newport-plaid-key'),require('crypto').randomBytes(32).toString('base64'),{flag:'wx'})"
   ```

   Restrict that file's access to your Windows account. Copy its value into the secret manager or ignored environment configuration; protect or remove the temporary file afterward. Never paste it into a support message.
5. Configure server-only `SUPABASE_SERVICE_ROLE_KEY`, plus existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Set `NEXT_PUBLIC_SITE_URL` to the actual browser origin. Developer credentials must never be configured as public environment variables.
6. Remove obsolete `PLAID_CLIENT_ID`, `PLAID_SECRET`, and `PLAID_ENV` settings from your hosting configuration and local environment. Runtime code never reads them.
7. Apply the reviewed migration through your normal manual process before running this version of the application. Run your disposable-project RLS checks afterward. Do not point tests at family financial data.

## Family member setup

1. Sign into your own Dick-Newport account and open **Settings → Personal Plaid Credentials** at `/settings/profile`.
2. In your personal [Plaid Dashboard](https://dashboard.plaid.com/), find your Client ID and the secret for your chosen environment. Choose **Sandbox** for test institutions. Real accounts require your own **Production** approval and product access.
3. Enter the Client ID and API secret, select the matching environment, and choose **Save credentials**. The server verifies the credentials before saving encrypted data. Your saved secret will never appear in the form again.
4. Return to the dashboard. Select **Transactions and balances** or **Investments and balances**, then **Connect a bank** and **Open Plaid**. Only request a product your developer account supports. Connect separate Items as needed for different products.
5. Complete Plaid Link. The application saves the connection and refreshes your financial data. Sandbox credentials cannot access Production Items, and another family member's credentials cannot refresh your Items.

**Verify credentials** checks authentication with Plaid's Institutions API. It does not promise Production approval or access to every product. Plaid checks the selected product when Link is created and when data is requested. Check your own developer Dashboard when access is missing. Institutions and product coverage vary.

## Replacement, deletion, and recovery

- To replace credentials, enter a new Client ID and secret into the empty fields, choose the environment, and select **Replace credentials**. The new credentials are verified first. Existing personal connections are then removed using the old developer credentials before the old encrypted record is deleted and a new version is saved. Reconnect institutions afterward.
- **Delete credentials** disables the credential record immediately, revokes each dependent Item, removes its encrypted access token, and deletes the encrypted credentials. It preserves historical financial records. Deletion also serves as credential revocation within this application; rotate developer secrets separately in your Plaid Dashboard if needed.
- If remote revocation fails, the original encrypted credentials and remaining tokens stay stored in a disabled `revoking` state. Retry **Delete credentials**. Do not discard the old developer account or change the server encryption key while revocation is pending. Already revoked Items are detached, so retries continue safely.
- A failed save after successful revocation leaves no active credentials. Retry saving; historical records remain.
- Link sessions carry an encrypted owner-bound reference to their credential version and expire after 30 minutes. Start a new connection after replacing credentials or changing environment.
- Unknown balances remain `NULL`, and unsupported investments do not delete existing holdings or create zero snapshots. Balances use [Accounts Get](https://plaid.com/docs/api/accounts/), which returns the latest cached institution balances, usually updated by enabled products. This implementation does not purchase on-demand Balance refreshes.
- Reconnection preserves old history but does not automatically merge old and new Plaid account identities. Check for historical and newly connected accounts before comparing totals.

## Encryption and operational locks

AES-256-GCM encrypts both developer credentials (Client ID and secret together) and new Item access tokens. Random nonces and authentication tags prevent undetected tampering. Credential ciphertext is bound to owner, credential version, and environment; access tokens are bound to owner, credential version, and Item identity. Supabase's browser roles have no table privileges on credentials, access tokens, or operation locks. Only authenticated server endpoints return safe credential metadata.

Every credential mutation, Link creation, token exchange, and refresh uses the same database operation lock per user. Locks deliberately have no automatic expiry, so a slow or crashed process cannot race credential deletion or reuse a replaced record. Normal completion releases the lock. If requests repeatedly report another running operation, an administrator must first stop/drain the old workers, verify that no operation is still executing, and then delete **only that user's abandoned row** from `public.user_plaid_operations` using trusted database administration. Never clear a lock just because an operation appears slow. No secrets are needed to inspect its `user_id` and `started_at`.

Back up the encryption key independently of the database. To rotate the server key, stop/drain all application instances, back up both key and database, decrypt and re-encrypt credential and Item ciphertext with the same bindings using a trusted offline process, then atomically switch the environment key and restart. There is no automatic key-rotation command in this change. Losing the key requires revocation through the personal Plaid Dashboards and administrator-assisted local cleanup; a new key cannot decrypt previous records.

## Validation and limits

Run from cmd with the portable Node path above:

```cmd
npm test
npx tsc --noEmit
npm run build
npm run lint
```

The test suite includes in-memory Postgres migration replay and role/constraint checks, mocked Supabase/Plaid HTTP integration tests, encryption tests, refresh tests, and existing dashboard tests. The in-memory database uses synthetic Auth schema objects; it does not replace live Supabase Auth, REST, or real Plaid testing. `npm run test:rls` requires the existing explicitly configured disposable Supabase target and disposable users; it is skipped by default. Never deploy migrations automatically to make tests pass.

Live Production approval, institution consent flows, and real provider revocation still need validation with each owner's developer account. US institutions remain the existing application's supported country scope. Legacy specialist repair endpoints remain disabled and require authentication; the active refresh path handles both supported connection products.

If exchanging a token cannot be persisted, the server attempts immediate Item removal. A simultaneous database outage and Plaid removal failure can leave an untracked remote Item; remove it in the personal Plaid Dashboard. No distributed transaction exists between Plaid and Supabase.
