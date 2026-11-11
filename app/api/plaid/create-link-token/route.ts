import { Products } from "plaid";
import { createLinkTokenRequest, getUserPlaidClient } from "../../../../lib/plaidClient";
import { encryptPlaidSecret } from "../../../../lib/plaidEncryption";
import { personalPlaidRoute } from "../../../../lib/plaidRoute";
import { PlaidOperationError } from "../../../../lib/plaidOperations";
import { readLimitedJson } from "../../../../lib/requestSecurity";

export async function POST(request: Request) {
  return personalPlaidRoute(request, async context => {
    let product = Products.Transactions;
    if (request.body) {
      let body;
      try { body = await readLimitedJson(request); } catch { throw new PlaidOperationError("A small JSON product request is required"); }
      if (Object.keys(body).some(key => key !== "product") || !["transactions", "investments"].includes(String(body.product))) {
        throw new PlaidOperationError("Choose Transactions or Investments");
      }
      product = body.product as Products;
    }
    const { client, credentialId } = await getUserPlaidClient(context);
    const response = await client.linkTokenCreate(createLinkTokenRequest(context.userId, product));
    const credentialSession = encryptPlaidSecret(JSON.stringify({ credentialId, product, expires: Date.now() + 30 * 60 * 1000 }), `link:${context.userId}`);
    return { link_token: response.data.link_token, expiration: response.data.expiration, credential_session: credentialSession };
  });
}
