import { Configuration, CountryCode, PlaidApi, Products } from "plaid";
import { decryptPlaidSecret } from "./plaidEncryption";
import { isAuthenticatedPlaidContext, type PlaidUserContext } from "./plaidTenant";
import { PlaidOperationError } from "./plaidOperations";

export type PlaidEnvironment = "sandbox" | "production";
export type PersonalPlaidCredentials = { clientId: string; secret: string; environment: PlaidEnvironment };

export function createPlaidClient(credentials: PersonalPlaidCredentials) {
  if (typeof window !== "undefined") throw new Error("Plaid developer credentials are server-only");
  if (!credentials || !credentials.clientId || !credentials.secret || !["sandbox", "production"].includes(credentials.environment)) {
    throw new Error("Personal Plaid credentials are required");
  }
  return new PlaidApi(new Configuration({
    basePath: `https://${credentials.environment}.plaid.com`,
    baseOptions: { timeout: 20000, headers: { "PLAID-CLIENT-ID": credentials.clientId, "PLAID-SECRET": credentials.secret } },
  }));
}

export async function getUserPlaidClient(context: PlaidUserContext, credentialId?: string) {
  if (!isAuthenticatedPlaidContext(context)) throw new Error("Authentication required");
  let query = context.supabase.from("user_plaid_credentials")
    .select("id, user_id, encrypted_credentials, environment, status")
    .eq("user_id", context.userId).eq("status", "active");
  if (credentialId) query = query.eq("id", credentialId);
  const { data, error } = await query.maybeSingle();
  if (error || !data || data.user_id !== context.userId || (credentialId && data.id !== credentialId)) {
    throw new PlaidOperationError("Save active personal Plaid credentials in Settings before connecting", 409);
  }
  const credentials = decryptCredentials(data.encrypted_credentials, `${context.userId}:${data.id}:${data.environment}`);
  return { credentialId: data.id as string, client: createPlaidClient({ ...credentials, environment: data.environment }) };
}

export function decryptCredentials(ciphertext: string, binding: string): Pick<PersonalPlaidCredentials, "clientId" | "secret"> {
  try {
    const value = JSON.parse(decryptPlaidSecret(ciphertext, binding));
    if (!value || typeof value.clientId !== "string" || typeof value.secret !== "string") throw new Error();
    return { clientId: value.clientId, secret: value.secret };
  } catch { throw new PlaidOperationError("Unable to unlock saved credentials. Check the server encryption key.", 503); }
}

export function createLinkTokenRequest(userId: string, product: Products = Products.Transactions) {
  return { client_name: "Dick-Newport", language: "en", country_codes: [CountryCode.Us],
    user: { client_user_id: userId }, products: [product] };
}
