import type { SupabaseClient } from "@supabase/supabase-js";
import accounting from "./accounting";
import { getDashboardAccountClass, type DashboardAccount } from "./dashboard";

export type ConnectedAccount = DashboardAccount & {
  persistent_account_id: string | null;
  created_at: string;
  updated_at: string | null;
};

export function summarizeConnectedPosition(records: ConnectedAccount[]) {
  const seen = new Set<string>();
  const accounts = [...records].sort((a, b) =>
    (Date.parse(b.updated_at ?? "") || 0) - (Date.parse(a.updated_at ?? "") || 0) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
  ).filter((a) => {
    const identity = a.persistent_account_id ? `durable:${a.persistent_account_id}` : a.plaid_account_id ? `plaid:${a.plaid_account_id}` : `row:${a.id}`;
    if (seen.has(identity)) return false;
    seen.add(identity); return true;
  });
  // Account balances already include securities. Holdings are intentionally
  // absent from this input so they cannot be added to the same assets twice.
  const summary = accounting.summarizeAccounts(accounts);
  const unknownTypes = accounts.some((a) => getDashboardAccountClass(a) === "other" && a.account_type !== "crypto");
  if (unknownTypes) summary.netWorth = null;
  return { accounts, summary, duplicatesOmitted: records.length - accounts.length, unknownTypes };
}

export async function loadConnectedPosition(client: SupabaseClient, userId: string) {
  const { data, error, count } = await client.from("accounts")
    .select("id, institution_name, account_name, account_type, account_subtype, current_balance, available_balance, currency, plaid_account_id, persistent_account_id, created_at, updated_at", { count: "exact" })
    .eq("user_id", userId).order("id").limit(501);
  if (error || !Array.isArray(data) || count == null || count > 500 || data.length !== count)
    throw new Error("Connected account coverage unavailable");
  return summarizeConnectedPosition(data.map((a) => ({ ...a, mask: null })) as ConnectedAccount[]);
}
