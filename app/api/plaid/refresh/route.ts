import { NextResponse } from "next/server";
import { getUserPlaidClient } from "../../../../lib/plaidClient";
import { withPlaidOperation } from "../../../../lib/plaidOperations";
import { createPlaidRefreshContext, refreshFinancialData } from "../../../../lib/plaidRefresh";
import { isSameOriginRequest } from "../../../../lib/requestSecurity";
import { getAuthenticatedPlaidContext } from "../../../../lib/plaidTenant";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }

  let authenticatedContext;
  try {
    authenticatedContext = await getAuthenticatedPlaidContext(request);
  } catch {
    return NextResponse.json({ error: "Unable to authenticate Plaid refresh request" }, { status: 500 });
  }
  if (!authenticatedContext) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }
  if (request.body) return NextResponse.json({ error: "Refresh does not accept a request body" }, { status: 400 });

  try {
    const result = await withPlaidOperation(authenticatedContext, async () => {
      const { client, credentialId } = await getUserPlaidClient(authenticatedContext);
      const refreshContext = createPlaidRefreshContext(authenticatedContext, client, credentialId);
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
      })),
    });
  } catch {
    return NextResponse.json({ error: "Unable to refresh Plaid connections" }, { status: 500 });
  }
}
