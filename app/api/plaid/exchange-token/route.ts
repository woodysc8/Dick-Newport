import { getUserPlaidClient } from "../../../../lib/plaidClient";
import { decryptPlaidSecret, encryptPlaidSecret } from "../../../../lib/plaidEncryption";
import { personalPlaidRoute } from "../../../../lib/plaidRoute";
import { PlaidOperationError } from "../../../../lib/plaidOperations";
import { readLimitedJson } from "../../../../lib/requestSecurity";

export async function POST(request: Request) {
  return personalPlaidRoute(request, async context => {
    let body;
    try { body = await readLimitedJson(request); } catch { throw new PlaidOperationError("A small JSON public token request is required"); }
    if (Object.keys(body).some(key => !["public_token", "credential_session"].includes(key)) ||
      typeof body.public_token !== "string" || !body.public_token.trim() || body.public_token.length > 512 ||
      typeof body.credential_session !== "string" || body.credential_session.length > 2048) {
      throw new PlaidOperationError("A public token and its credential session are required");
    }
    let session;
    try { session = JSON.parse(decryptPlaidSecret(body.credential_session, `link:${context.userId}`)); }
    catch { throw new PlaidOperationError("Invalid Link session. Start a new connection."); }
    if (typeof session.credentialId !== "string" || !Number.isFinite(session.expires) || session.expires < Date.now() ||
      !["transactions", "investments"].includes(session.product)) throw new PlaidOperationError("Link session expired. Start a new connection.");
    const { client, credentialId } = await getUserPlaidClient(context, session.credentialId);
    const response = await client.itemPublicTokenExchange({ public_token: body.public_token.trim() });
    const { item_id: itemId, access_token: accessToken } = response.data;
    let persisted = false;
    let cleanupSafe = false;
    try {
      const { data: existing, error } = await context.supabase.from("plaid_items")
        .select("id, user_id, credential_id").eq("plaid_item_id", itemId).maybeSingle();
      if (error) throw new Error();
      if (existing) {
        // Never revoke or overwrite a saved Item on repeated finalization.
        if (existing.user_id !== context.userId || existing.credential_id !== credentialId) {
          throw new PlaidOperationError("This connection is already saved with another credential record. Refresh the existing connection instead.", 409);
        }
        persisted = true;
        return { connected: true, plaid_item_id: itemId, institution_name: null };
      }
      cleanupSafe = true;
      const { error: saveError } = await context.supabase.from("plaid_items").insert({
        user_id: context.userId, plaid_item_id: itemId,
        access_token: encryptPlaidSecret(accessToken, `item:${context.userId}:${credentialId}:${itemId}`),
        credential_id: credentialId, connection_status: "active", products: [session.product],
      });
      if (saveError) throw new Error();
      persisted = true;
      return { connected: true, plaid_item_id: itemId, institution_name: null };
    } finally {
      if (!persisted && cleanupSafe) {
        try {
          // A conflicting insert can have saved the same Item since the first lookup.
          const { data: saved, error } = await context.supabase.from("plaid_items")
            .select("id").eq("plaid_item_id", itemId).maybeSingle();
          if (!error && !saved) await client.itemRemove({ access_token: accessToken });
        } catch { /* Never log provider errors or revoke on an ambiguous lookup. */ }
      }
    }
  });
}
