import { getAuthenticatedPlaidContext } from "../../../../lib/plaidTenant";
import { personalPlaidRoute } from "../../../../lib/plaidRoute";
import { syncItemHoldings, verifyHoldingsConsent } from "../../../../lib/plaidHoldings";
import { readLimitedJson } from "../../../../lib/requestSecurity";
import { PlaidOperationError } from "../../../../lib/plaidOperations";

export async function GET(request: Request) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  try {
    const context = await getAuthenticatedPlaidContext(request);
    if (!context) return json({ error: "Authentication required" }, 401);
    const items = await context.supabase.from("plaid_items").select("id, plaid_item_id, institution_name, products, connection_status", { count: "exact" }).eq("user_id", context.userId).order("id").limit(501);
    let accounts = await context.supabase.from("accounts").select("id, plaid_item_id, account_name, account_type, account_subtype, holdings_status, holdings_synced_at", { count: "exact" }).eq("user_id", context.userId).order("id").limit(501);
    let setupRequired = false;
    if (accounts.error && ["42703", "PGRST204"].includes(accounts.error.code)) {
      setupRequired = true;
      accounts = await context.supabase.from("accounts").select("id, plaid_item_id, account_name, account_type, account_subtype", { count: "exact" }).eq("user_id", context.userId).order("id").limit(501) as typeof accounts;
    }
    if (items.error || accounts.error || items.count == null || accounts.count == null || items.count > 500 || accounts.count > 500 || items.data?.length !== items.count || accounts.data?.length !== accounts.count) return json({ error: "Holdings connection coverage unavailable" }, 503);
    return json({ setupRequired, connections: items.data.map((item) => ({ id: item.id, institution: item.institution_name ?? "Institution unverified", active: item.connection_status === "active", permissionRecorded: item.products.includes("investments"), accounts: accounts.data!.filter((a) => a.plaid_item_id === item.plaid_item_id && ["investment", "crypto", "retirement"].includes(a.account_type ?? "")).map((a) => ({ id: a.id, name: a.account_name, subtype: a.account_subtype, status: setupRequired ? "not_synced" : a.holdings_status, syncedAt: setupRequired ? null : a.holdings_synced_at })) })) });
  } catch { return json({ error: "Holdings connection status unavailable" }, 503); }
}
export async function POST(request: Request) {
  return personalPlaidRoute(request, async (context) => {
    let body;
    try { body = await readLimitedJson(request); } catch { throw new PlaidOperationError("A small JSON holdings request is required"); }
    if (body.action === "verify" && typeof body.credential_session === "string" && body.credential_session.length <= 4096 && Object.keys(body).every((key) => ["action", "credential_session"].includes(key))) return verifyHoldingsConsent(context, body.credential_session);
    if (body.action === "sync" && body.approved === true && typeof body.connection_id === "string" && Object.keys(body).every((key) => ["action", "connection_id", "approved"].includes(key))) return syncItemHoldings(context, body.connection_id);
    throw new PlaidOperationError("Choose consent verification or explicitly approve Sync holdings");
  });
}
