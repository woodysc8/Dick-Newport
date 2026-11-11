import { CountryCode } from "plaid";
import { createPlaidClient, decryptCredentials, getUserPlaidClient, type PersonalPlaidCredentials } from "./plaidClient";
import { decryptPlaidSecret, encryptPlaidSecret } from "./plaidEncryption";
import { PlaidOperationError, safePlaidError } from "./plaidOperations";
import { isAuthenticatedPlaidContext, type PlaidUserContext } from "./plaidTenant";

export function validateCredentials(body: Record<string, unknown>): PersonalPlaidCredentials {
  if (Object.keys(body).some(key => !["clientId", "secret", "environment"].includes(key)) ||
    typeof body.clientId !== "string" || !/^[a-f0-9]{24}$/i.test(body.clientId) ||
    typeof body.secret !== "string" || !/^[a-f0-9]{30,128}$/i.test(body.secret) ||
    (body.environment !== "sandbox" && body.environment !== "production")) {
    throw new PlaidOperationError("Enter a valid Plaid Client ID, API secret, and Sandbox or Production environment.");
  }
  return { clientId: body.clientId, secret: body.secret, environment: body.environment };
}

export async function credentialStatus(context: PlaidUserContext) {
  if (!isAuthenticatedPlaidContext(context)) throw new PlaidOperationError("Authentication required", 401);
  const { data, error } = await context.supabase.from("user_plaid_credentials")
    .select("id, environment, status, verified_at").eq("user_id", context.userId).maybeSingle();
  if (error) throw new PlaidOperationError("Unable to load credential status", 503);
  return data ? { configured: true, environment: data.environment, status: data.status, verifiedAt: data.verified_at } : { configured: false };
}

export async function verifyCredentials(context: PlaidUserContext, input?: PersonalPlaidCredentials) {
  if (!isAuthenticatedPlaidContext(context)) throw new PlaidOperationError("Authentication required", 401);
  const client = input ? createPlaidClient(input) : (await getUserPlaidClient(context)).client;
  try { await client.institutionsGet({ country_codes: [CountryCode.Us], count: 1, offset: 0 }); }
  catch (error) { throw new PlaidOperationError(safePlaidError(error), 422); }
  if (!input) {
    const { error } = await context.supabase.from("user_plaid_credentials")
      .update({ verified_at: new Date().toISOString() }).eq("user_id", context.userId).eq("status", "active");
    if (error) throw new PlaidOperationError("Unable to record verification", 503);
  }
}

// Caller holds the user's operation lock throughout remote revocation and persistence.
// A failed remote removal retains ciphertext and tokens in a disabled, retryable state.
export async function deleteCredentials(context: PlaidUserContext) {
  if (!isAuthenticatedPlaidContext(context)) throw new PlaidOperationError("Authentication required", 401);
  const { data: saved, error } = await context.supabase.from("user_plaid_credentials")
    .select("id, environment, encrypted_credentials").eq("user_id", context.userId).maybeSingle();
  if (error) throw new PlaidOperationError("Unable to load credentials", 503);
  if (!saved) return;
  const { error: disableError } = await context.supabase.from("user_plaid_credentials")
    .update({ status: "revoking" }).eq("id", saved.id).eq("user_id", context.userId);
  if (disableError) throw new PlaidOperationError("Unable to disable credentials", 503);
  const input = decryptCredentials(saved.encrypted_credentials, `${context.userId}:${saved.id}:${saved.environment}`);
  const client = createPlaidClient({ ...input, environment: saved.environment });
  const { data: items, error: itemsError } = await context.supabase.from("plaid_items")
    .select("id, plaid_item_id, access_token").eq("user_id", context.userId).eq("credential_id", saved.id);
  if (itemsError) throw new PlaidOperationError("Unable to load dependent connections", 503);
  for (const item of items ?? []) {
    if (item.access_token) {
      try {
        const token = decryptPlaidSecret(item.access_token, `item:${context.userId}:${saved.id}:${item.plaid_item_id}`);
        await client.itemRemove({ access_token: token });
      }
      catch (error) {
        const code = (error as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
        if (code !== "ITEM_NOT_FOUND" && code !== "INVALID_ACCESS_TOKEN") {
          throw new PlaidOperationError("Revocation is incomplete. Connections are disabled; retry Delete credentials with the original credentials still available.", 409);
        }
      }
    }
    const { error: detachError } = await context.supabase.from("plaid_items")
      .update({ credential_id: null, access_token: null, connection_status: "revoked" })
      .eq("id", item.id).eq("user_id", context.userId).eq("credential_id", saved.id);
    if (detachError) throw new PlaidOperationError("Unable to detach revoked connection. Retry deletion.", 503);
  }
  const { error: deleteError } = await context.supabase.from("user_plaid_credentials").delete().eq("id", saved.id).eq("user_id", context.userId);
  if (deleteError) throw new PlaidOperationError("Unable to delete credentials. Retry deletion.", 503);
}

export async function saveCredentials(context: PlaidUserContext, input: PersonalPlaidCredentials, replace: boolean) {
  if (!isAuthenticatedPlaidContext(context)) throw new PlaidOperationError("Authentication required", 401);
  const status = await credentialStatus(context);
  if (status.configured && !replace) throw new PlaidOperationError("Use Replace credentials to revoke existing connections first.", 409);
  if (status.status === "revoking") throw new PlaidOperationError("Finish deleting the previous credentials before saving new ones.", 409);
  await verifyCredentials(context, input);
  const id = crypto.randomUUID();
  const encrypted = encryptPlaidSecret(JSON.stringify({ clientId: input.clientId, secret: input.secret }), `${context.userId}:${id}:${input.environment}`);
  if (status.configured) await deleteCredentials(context);
  const { error } = await context.supabase.from("user_plaid_credentials").insert({
    id, user_id: context.userId, environment: input.environment, encrypted_credentials: encrypted,
    verified_at: new Date().toISOString(), status: "active",
  });
  if (error) throw new PlaidOperationError("Unable to save credentials. Previous connections, if any, were revoked; retry saving.", 503);
}
