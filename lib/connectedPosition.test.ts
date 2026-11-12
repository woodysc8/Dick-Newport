import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadConnectedPosition, summarizeConnectedPosition, type ConnectedAccount } from "./connectedPosition";

const account: ConnectedAccount = { id: "cash", account_name: "Checking", institution_name: "Fixture", account_type: "depository", account_subtype: "checking", current_balance: 1000, available_balance: 900, currency: "USD", mask: null, persistent_account_id: null, created_at: "2026-01-01", updated_at: "2026-11-12", plaid_account_id: "provider-cash" };
it("uses connected account assets minus liabilities, with no holding or manual-asset addition", () => {
  const { summary } = summarizeConnectedPosition([account,
    { ...account, id: "investment", plaid_account_id: "provider-investment", account_type: "investment", account_subtype: "brokerage", current_balance: 500 },
    { ...account, id: "card", plaid_account_id: "provider-card", account_type: "credit", account_subtype: "credit card", current_balance: 200 },
    { ...account, id: "loan", plaid_account_id: "provider-loan", account_type: "loan", account_subtype: "student loan", current_balance: 100 },
  ]);
  expect(summary).toMatchObject({ cash: 1000, investments: 500, credit: 300, netWorth: 1200 });
});
it("deduplicates stored account identities using the latest recorded balance", () => {
  const old = { ...account, persistent_account_id: "same", updated_at: "2026-11-01", current_balance: 900 };
  const newest = { ...old, id: "new", plaid_account_id: "new-provider", updated_at: "2026-11-12", current_balance: 1000 };
  const result = summarizeConnectedPosition([old, newest]);
  expect(result.summary.netWorth).toBe(1000);
  expect(result.duplicatesOmitted).toBe(1);
});
it("does not report complete net worth when balances, currency or account types are unsupported", () => {
  expect(summarizeConnectedPosition([{ ...account, current_balance: null }]).summary.netWorth).toBeNull();
  expect(summarizeConnectedPosition([{ ...account, currency: null }]).summary.netWorth).toBeNull();
  expect(summarizeConnectedPosition([account, { ...account, id: "other", plaid_account_id: "other", account_type: "other", account_subtype: null }]).summary.netWorth).toBeNull();
  expect(summarizeConnectedPosition([]).summary.netWorth).toBeNull();
});
it("reads only the verified owner's accounts with exact coverage and no mutations", async () => {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), order: vi.fn(() => q), limit: vi.fn(async () => ({ data: [account], count: 1, error: null })) };
  const from = vi.fn(() => q);
  const result = await loadConnectedPosition({ from } as unknown as SupabaseClient, "owner");
  expect(from).toHaveBeenCalledOnce();
  expect(from).toHaveBeenCalledWith("accounts");
  expect(q.eq).toHaveBeenCalledWith("user_id", "owner");
  expect(q.limit).toHaveBeenCalledWith(501);
  expect(result.summary.netWorth).toBe(1000);
});
it("rejects partial coverage and query failures", async () => {
  for (const response of [{ data: [account], count: 2, error: null }, { data: null, count: null, error: { message: "private" } }]) {
    const q = { select: vi.fn(() => q), eq: vi.fn(() => q), order: vi.fn(() => q), limit: vi.fn(async () => response) };
    await expect(loadConnectedPosition({ from: () => q } as unknown as SupabaseClient, "owner")).rejects.toThrow("coverage unavailable");
  }
});
