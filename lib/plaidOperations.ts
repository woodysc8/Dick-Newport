import { isAuthenticatedPlaidContext, type PlaidUserContext } from "./plaidTenant";
import type { CredentialStage } from "./plaidCredentialConfiguration";

export class PlaidOperationError extends Error {
  constructor(message: string, public status = 400, public stage?: CredentialStage) { super(message); }
}

export function safePlaidError(error: unknown): string {
  const code = (error as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
  switch (code) {
    case "INVALID_API_KEYS": return "Plaid rejected these credentials. Check the Client ID, secret, and environment.";
    case "INVALID_PRODUCT": case "PRODUCT_NOT_SUPPORTED": case "ADDITIONAL_CONSENT_REQUIRED":
      return "This Plaid account or institution does not support the requested product.";
    case "INVALID_API_KEY": case "UNAUTHORIZED": case "PRODUCTION_ACCESS_NOT_GRANTED": case "ACCESS_NOT_GRANTED":
      return "Production or product access is not enabled. Check your personal Plaid Dashboard.";
    default: return "Plaid could not complete this request. Check your credentials, environment, and product access in your personal Plaid Dashboard, then retry.";
  }
}

export async function withPlaidOperation<T>(context: PlaidUserContext, work: () => Promise<T>): Promise<T> {
  if (!isAuthenticatedPlaidContext(context)) throw new PlaidOperationError("Authentication required", 401);
  const token = crypto.randomUUID();
  const { data, error } = await context.supabase.rpc("acquire_personal_plaid_operation", { owner_id: context.userId, operation_token: token });
  if (error) throw new PlaidOperationError("Unable to secure Plaid operation", 503);
  if (!data) throw new PlaidOperationError("Another Plaid operation is running. Please retry shortly.", 409);
  try { return await work(); }
  finally {
    try {
      const { error: releaseError } = await context.supabase.from("user_plaid_operations").delete().eq("user_id", context.userId).eq("token", token);
      if (releaseError) throw new Error();
    } catch {
      throw new PlaidOperationError("The operation finished but its lock could not be released. Refresh status and ask the administrator to check the operation lock before retrying.", 503, "lock_release");
    }
  }
}
