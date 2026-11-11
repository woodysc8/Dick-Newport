import { getAuthenticatedSupabaseContext } from "./supabase/server";
import { isSameOriginRequest, readLimitedJson } from "./requestSecurity";
import {
  TransactionInputError,
  TransactionAvailabilityError,
} from "./transactionData";
import type { AuthenticatedSupabaseContext } from "./supabase/server";

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function transactionRoute(
  request: Request,
  work: (
    context: AuthenticatedSupabaseContext,
    body: Record<string, unknown>,
  ) => Promise<unknown>,
) {
  try {
    if (request.method !== "GET" && !isSameOriginRequest(request))
      return json({ error: "Cross-origin requests are not allowed" }, 403);
    const context = await getAuthenticatedSupabaseContext(request);
    if (!context) return json({ error: "Authentication required" }, 401);
    let body = {};
    if (request.method !== "GET") {
      try {
        body = await readLimitedJson(request);
      } catch {
        return json({ error: "A small JSON request is required" }, 400);
      }
    }
    return json(await work(context, body));
  } catch (error) {
    if (error instanceof TransactionAvailabilityError)
      return json({ error: error.message }, 503);
    if (error instanceof TransactionInputError)
      return json({ error: error.message }, 400);
    // Includes missing additive schema; never return raw database or auth errors.
    return json(
      {
        error:
          "Transaction or weekly budget data is unavailable. Retry; if this persists, ask the administrator to verify the transactions/weekly budget migration.",
      },
      503,
    );
  }
}
