import { getAuthenticatedPlaidContext, type PlaidUserContext } from "./plaidTenant";
import { isSameOriginRequest } from "./requestSecurity";
import { PlaidOperationError, safePlaidError, withPlaidOperation } from "./plaidOperations";

export async function personalPlaidRoute(request: Request, work: (context: PlaidUserContext) => Promise<unknown>) {
  if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  try {
    const context = await getAuthenticatedPlaidContext(request);
    if (!context) return Response.json({ error: "Authentication required" }, { status: 401 });
    const result = await withPlaidOperation(context, () => work(context));
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof PlaidOperationError ? error.message : safePlaidError(error) },
      { status: error instanceof PlaidOperationError ? error.status : 422, headers: { "Cache-Control": "no-store" } });
  }
}
