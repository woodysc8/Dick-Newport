import type { SupabaseClient } from "@supabase/supabase-js";
import accounting from "./accounting";
import { getDashboardAccountClass, type DashboardAccount } from "./dashboard";

export type ConnectedAccount = DashboardAccount & {
  persistent_account_id: string | null;
  created_at: string;
  updated_at: string | null;
  plaid_item_id?: string | null;
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
  // Separate investment connections can overlap without durable IDs. Do not
  // deduplicate by names or masks, and do not present an ambiguous sum as wealth.
  const investments = accounts.filter((a) => ["investment", "retirement"].includes(getDashboardAccountClass(a)) || a.account_type === "crypto");
  const institution = (a: ConnectedAccount) => a.institution_name?.trim().toLowerCase() ?? "";
  const unknownInstitution = (a: ConnectedAccount) => ["", "unknown institution", "institution unverified"].includes(institution(a));
  const unresolvedInvestmentOverlap = investments.some((a, index) => investments.slice(index + 1).some((b) =>
    a.plaid_item_id && b.plaid_item_id && a.plaid_item_id !== b.plaid_item_id &&
    (institution(a) === institution(b) || unknownInstitution(a) || unknownInstitution(b)) &&
    (a.account_subtype === b.account_subtype || !a.account_subtype || !b.account_subtype) && (!a.persistent_account_id || !b.persistent_account_id)
  ));
  if (unknownTypes || unresolvedInvestmentOverlap) summary.netWorth = null;
  if (unresolvedInvestmentOverlap) { summary.investments = null; summary.crypto = null; }
  return { accounts, summary, duplicatesOmitted: records.length - accounts.length, unknownTypes, unresolvedInvestmentOverlap };
}

export async function loadConnectedPosition(client: SupabaseClient, userId: string) {
  const { data, error, count } = await client.from("accounts")
    .select("id, institution_name, account_name, account_type, account_subtype, current_balance, available_balance, currency, plaid_item_id, plaid_account_id, persistent_account_id, created_at, updated_at", { count: "exact" })
    .eq("user_id", userId).order("id").limit(501);
  if (error || !Array.isArray(data) || count == null || count > 500 || data.length !== count)
    throw new Error("Connected account coverage unavailable");
  return summarizeConnectedPosition(data.map((a) => ({ ...a, mask: null })) as ConnectedAccount[]);
}
