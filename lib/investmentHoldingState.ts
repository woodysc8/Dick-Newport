import type { SupabaseClient } from "@supabase/supabase-js";
export type InvestmentAccountState = { id: string; plaid_account_id: string | null; plaid_item_id: string | null; account_name: string | null; account_type: string | null; account_subtype: string | null; holdings_status?: string; holdings_synced_at?: string | null };
export async function loadInvestmentHoldingState(client: SupabaseClient, owner: string) {
  const base = "id, plaid_account_id, plaid_item_id, account_name, account_type, account_subtype";
  let result = await client.from("accounts").select(`${base}, holdings_status, holdings_synced_at`, { count: "exact" }).eq("user_id", owner).order("id").limit(501);
  let schemaReady = true;
  if (result.error && ["42703", "PGRST204"].includes(result.error.code)) {
    schemaReady = false;
    result = await client.from("accounts").select(base, { count: "exact" }).eq("user_id", owner).order("id").limit(501) as typeof result;
  }
  if (result.error || result.count == null || result.count > 500 || result.data?.length !== result.count) throw new Error("Investment account coverage unavailable");
  return { schemaReady, accounts: (result.data as InvestmentAccountState[]).filter((a) => ["investment", "crypto", "retirement"].includes(a.account_type ?? "")) };
}
export function holdingStatusMessage(status: string | undefined, syncedAt: string | null | undefined) {
  const date = syncedAt && Number.isFinite(Date.parse(syncedAt)) ? new Date(syncedAt).toISOString() : "Unavailable";
  const messages: Record<string, string> = {
    ready: "Stored holdings available", empty: "Plaid returned no holdings for this account in the last successful import; this does not mean the account balance is zero",
    unsupported: "Holdings unsupported for this connection", permission_required: "Investments permission required — use Enable holdings",
    not_ready: "Plaid is preparing holdings — retry Sync holdings later", not_returned: "Account missing from the latest holdings response; old positions retained and may be stale",
    error: "Latest holdings import failed; old positions retained and may be stale", not_synced: "Holdings not yet synced",
  };
  return `${messages[status ?? "not_synced"] ?? "Holdings status unavailable"}. Last successful import: ${date}. Broker observation time and price freshness are unverified.`;
}
