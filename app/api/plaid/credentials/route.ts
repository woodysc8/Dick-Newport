import { getAuthenticatedPlaidContext } from "../../../../lib/plaidTenant";
import { credentialStatus, deleteCredentials, saveCredentials, validateCredentials, verifyCredentials } from "../../../../lib/plaidCredentials";
import { PlaidOperationError, withPlaidOperation } from "../../../../lib/plaidOperations";
import { isSameOriginRequest, readLimitedJson } from "../../../../lib/requestSecurity";
import { CredentialConfigurationError, type CredentialStage } from "../../../../lib/plaidCredentialConfiguration";

export const runtime = "nodejs";
const allow = "GET, HEAD, POST, PUT, DELETE, OPTIONS";
function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", Allow: allow } });
}
async function handle(request: Request) {
  let stage: CredentialStage = "origin_validation";
  const onStage = (value: CredentialStage) => { stage = value; };
  try {
    if (request.method !== "GET" && !isSameOriginRequest(request)) return json({ error: "Cross-origin requests are not allowed" }, 403);
    stage = "authentication";
    const context = await getAuthenticatedPlaidContext(request, creation => onStage(creation === "authenticated Supabase context creation" ? "authentication" : "service_client"));
    if (!context) return json({ error: "Authentication required" }, 401);
    stage = request.method === "GET" ? "credential_status" : "lock_acquire";
    const result = request.method === "GET" ? await credentialStatus(context, onStage) : await withPlaidOperation(context, async () => {
      stage = "body_validation";
      if (request.method === "DELETE") {
        if (request.body) throw new PlaidOperationError("Delete credentials does not accept a request body.");
        stage = "revocation";
        await deleteCredentials(context, onStage);
      }
      else {
        let body;
        try { body = await readLimitedJson(request); } catch { throw new PlaidOperationError("A JSON request of at most 4096 bytes is required."); }
        if (request.method === "POST" && body.action === "verify" && Object.keys(body).length === 1) {
          stage = "plaid_verification";
          await verifyCredentials(context, undefined, onStage);
        } else {
          const input = validateCredentials(body);
          stage = "credential_status";
          await saveCredentials(context, input, request.method === "PUT", onStage);
        }
      }
      return credentialStatus(context, onStage);
    });
    return json(result);
  } catch (error) {
    const status = error instanceof CredentialConfigurationError || error instanceof PlaidOperationError ? error.status : 500;
    if (error instanceof PlaidOperationError && error.stage) stage = error.stage;
    const category = error instanceof CredentialConfigurationError ? error.code
      : !(error instanceof PlaidOperationError) ? "unexpected_failure"
      : status === 400 ? "invalid_request" : status === 409 ? "operation_conflict"
      : status === 422 ? "provider_rejected" : stage === "plaid_verification" ? "provider_unavailable"
      : stage === "lock_release" ? "lock_release_failed" : stage === "lock_acquire" ? "lock_unavailable" : "storage_unavailable";
    // Fixed stage/category only: no errors, causes, IDs, headers, URLs or bodies.
    console.warn("Personal Plaid credential operation failed", { stage, category, status });
    if (error instanceof CredentialConfigurationError) return json({ error: error.message, code: error.code }, status);
    return json({ error: error instanceof PlaidOperationError ? error.message : "Unable to manage personal Plaid credentials. Check server encryption configuration and retry." },
      status);
  }
}
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
export async function PUT(request: Request) { return handle(request); }
export async function DELETE(request: Request) { return handle(request); }
export async function OPTIONS() { return json({ methods: allow.split(", ") }); }
export async function PATCH() { return json({ error: "Method not allowed" }, 405); }
