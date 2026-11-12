import { getUserPlaidClient } from "../../../../lib/plaidClient";
import { Products } from "plaid";
import { decryptPlaidSecret, encryptPlaidSecret } from "../../../../lib/plaidEncryption";
import { personalPlaidRoute } from "../../../../lib/plaidRoute";
import { PlaidOperationError } from "../../../../lib/plaidOperations";
import { readLimitedJson } from "../../../../lib/requestSecurity";
import { authorizedInvestmentProducts, verifiedInvestmentInstitution } from "../../../../lib/plaidHoldings";

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
        if (session.product === "investments") {
          const verified = await client.itemGet({ access_token: accessToken });
          if (verified.data.item.item_id !== itemId) throw new PlaidOperationError("Investment connection verification failed", 409);
          const products = authorizedInvestmentProducts(verified.data.item);
          const { error: verifyError } = await context.supabase.from("plaid_items").update({ products }).eq("user_id", context.userId).eq("id", existing.id).eq("credential_id", credentialId);
          if (verifyError) throw new PlaidOperationError("Investment permission could not be saved. Existing connection is unchanged.", 503);
          persisted = true;
          return { connected: true, investments_authorized: products.includes(Products.Investments), institution_name: null };
        }
        persisted = true;
        return { connected: true, institution_name: null };
      }
      cleanupSafe = true;
      // New Investments Items must be verified against Plaid, not the requested
      // Link product or client callback. Do not fetch positions at consent time.
      let products = [session.product], institutionName = null;
      if (session.product === "investments") {
        const verified = await client.itemGet({ access_token: accessToken });
        if (verified.data.item.item_id !== itemId) throw new PlaidOperationError("Investment connection verification failed", 409);
        products = authorizedInvestmentProducts(verified.data.item);
        institutionName = await verifiedInvestmentInstitution(client, verified.data.item);
      }
      const { error: saveError } = await context.supabase.from("plaid_items").insert({
        user_id: context.userId, plaid_item_id: itemId,
        access_token: encryptPlaidSecret(accessToken, `item:${context.userId}:${credentialId}:${itemId}`),
        credential_id: credentialId, connection_status: "active", products, institution_name: institutionName,
      });
      if (saveError) throw new Error();
      persisted = true;
      return { connected: true, institution_name: institutionName, investments_authorized: products.includes(Products.Investments) };
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
