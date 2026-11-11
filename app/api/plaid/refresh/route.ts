import { NextResponse } from "next/server";
import { getUserPlaidClient } from "../../../../lib/plaidClient";
import { PlaidOperationError, withPlaidOperation } from "../../../../lib/plaidOperations";
import { CredentialConfigurationError } from "../../../../lib/plaidCredentialConfiguration";
import { createPlaidRefreshContext, refreshFinancialData } from "../../../../lib/plaidRefresh";
import { isSameOriginRequest } from "../../../../lib/requestSecurity";
import { getAuthenticatedPlaidContext } from "../../../../lib/plaidTenant";

export async function POST(request: Request) {
  let stage = "origin_validation";
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
    }

    stage = "authentication";
    const authenticatedContext = await getAuthenticatedPlaidContext(request);
    if (!authenticatedContext) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }
    // Next's Node adapter supplies a stream even for a zero-byte POST.
    // Inspect bytes rather than stream presence; reject content without buffering it.
    stage = "body_validation";
    const reader = request.body?.getReader();
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.byteLength) {
            await reader.cancel();
            return NextResponse.json({ error: "Refresh does not accept a request body" }, { status: 400 });
          }
        }
      } finally { reader.releaseLock(); }
    }

    stage = "lock_acquire";
    const result = await withPlaidOperation(authenticatedContext, async () => {
      stage = "credential_loading";
      const { client, credentialId } = await getUserPlaidClient(authenticatedContext);
      const refreshContext = createPlaidRefreshContext(authenticatedContext, client, credentialId);
      stage = "financial_sync";
      return refreshFinancialData(refreshContext);
    });
    return NextResponse.json({
      success: result.success,
      status: result.status,
      items: result.items.map((item) => ({
        institution: item.institution,
        plaid_item_id: item.plaid_item_id,
        status: item.status,
        accounts_updated: item.accounts_updated,
        accounts_created: item.accounts_created,
        transactions_added: item.transactions_added,
        transactions_modified: item.transactions_modified,
        transactions_removed: item.transactions_removed,
        holdings_updated: item.holdings_updated,
        holdings_removed: item.holdings_removed,
        error_count: item.errors.length,
        warning_count: item.warnings.length,
        failed_stages: item.failed_stages,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof PlaidOperationError || error instanceof CredentialConfigurationError;
    const category = error instanceof CredentialConfigurationError ? "configuration" : error instanceof PlaidOperationError ? "operation" : "unexpected";
    console.warn("Plaid refresh failed", { stage, category });
    return NextResponse.json({ error: known ? error.message : "Unable to refresh Plaid connections", stage, category },
      { status: known ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
