import { getAuthenticatedPlaidContext } from "../../../../lib/plaidTenant";
import { credentialStatus, deleteCredentials, saveCredentials, validateCredentials, verifyCredentials } from "../../../../lib/plaidCredentials";
import { PlaidOperationError, withPlaidOperation } from "../../../../lib/plaidOperations";
import { isSameOriginRequest, readLimitedJson } from "../../../../lib/requestSecurity";

export const runtime = "nodejs";
const allow = "GET, HEAD, POST, PUT, DELETE, OPTIONS";
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Allow: allow } });
}
async function handle(request: Request) {
  try {
    if (request.method !== "GET" && !isSameOriginRequest(request)) return json({ error: "Cross-origin requests are not allowed" }, 403);
    const context = await getAuthenticatedPlaidContext(request);
    if (!context) return json({ error: "Authentication required" }, 401);
    const result = request.method === "GET" ? await credentialStatus(context) : await withPlaidOperation(context, async () => {
      if (request.method === "DELETE") {
        if (request.body) throw new PlaidOperationError("Delete credentials does not accept a request body.");
        await deleteCredentials(context);
      }
      else {
        let body;
        try { body = await readLimitedJson(request); } catch { throw new PlaidOperationError("A JSON request of at most 4096 bytes is required."); }
        if (request.method === "POST" && body.action === "verify" && Object.keys(body).length === 1) await verifyCredentials(context);
        else await saveCredentials(context, validateCredentials(body), request.method === "PUT");
      }
      return credentialStatus(context);
    });
    return json(result);
  } catch (error) {
    return json({ error: error instanceof PlaidOperationError ? error.message : "Unable to manage personal Plaid credentials. Check server encryption configuration and retry." },
      error instanceof PlaidOperationError ? error.status : 500);
  }
}
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
export async function PUT(request: Request) { return handle(request); }
export async function DELETE(request: Request) { return handle(request); }
export async function OPTIONS() { return json({ methods: allow.split(", ") }); }
export async function PATCH() { return json({ error: "Method not allowed" }, 405); }
