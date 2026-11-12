import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ position: vi.fn(), activity: vi.fn() }));
vi.mock("./connectedPosition", () => ({ loadConnectedPosition: mocks.position }));
vi.mock("./transactionData", () => ({ loadMonthlyActivity: mocks.activity }));
import { compareReport, generateFinancialReport, reportMoney, type FinancialReport } from "./financialReport";

const now = new Date("2026-11-12T15:00:00Z");
function client(holdings: unknown[] = [], count = holdings.length) {
  const filters: unknown[][] = [];
  return { filters, from: vi.fn((table: string) => {
    const result = table === "investment_holdings" ? { data: holdings, count, error: null } : table === "profiles" ? { data: { financial_profile: { currency: "USD", debts: [{ name: "Manual debt", balance: 500 }] } }, error: null } : { data: [{ updated_at: "2026-11-10T12:00:00Z" }], error: null };
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn((...args) => { filters.push(args); return query; }), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(result), maybeSingle: vi.fn().mockResolvedValue(result) };
    return query;
  }) };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.position.mockResolvedValue({ accounts: [{ id: "PRIVATE-ROW-ID", plaid_account_id: "PRIVATE-PROVIDER-ID", account_name: "Checking 123456789", institution_name: "Fixture", account_type: "depository", current_balance: 1500, currency: "USD", updated_at: "2026-11-01" }], summary: { netWorth: 1500, cash: 1500, investments: 0, crypto: 0, credit: 0, currency: "USD" }, duplicatesOmitted: 0, unknownTypes: false });
  mocks.activity.mockResolvedValue({ month: "2026-11", currency: "USD", postedPurchases: 140, confirmedPurchases: 100, unverifiedDebits: 40, pendingPurchases: 20, excludedMovements: 500, movementBreakdown: { cardPayments: 500 }, totalTransactions: 4, omittedDuplicates: 1, unresolvedRepeatedSources: 0, unknownAmountCount: 0, unknownStatusCount: 0, rows: [{ date: "2026-11-12", merchant: "Venmo", amount: 40, currency: "USD", pending: false, account: "Checking 123456789", purpose: "unverified" }] });
});
it("reuses shared totals, separates provisional amounts, redacts labels and scopes every read", async () => {
  const db = client();
  const report = await generateFinancialReport(db as unknown as SupabaseClient, "owner", null, now);
  const text = JSON.stringify(report);
  expect(report.netWorth).toBe(1500); // Manual debt/holdings never added again.
  expect(text).toContain("$140.00"); expect(text).toContain("provisional");
  expect(text).toContain("Purchase history unavailable");
  expect(text).toContain("2026-11-10T12:00:00.000Z");
  expect(text).not.toMatch(/PRIVATE-|123456789|access_token/);
  expect(db.filters).toEqual([["user_id", "owner"], ["id", "owner"], ["user_id", "owner"]]);
  expect(mocks.position).toHaveBeenCalledWith(db, "owner");
  expect(mocks.activity.mock.calls[0][2].get("month")).toBe("2026-11");
});
it("does not invent totals or a zero portfolio after failed/partial reads", async () => {
  mocks.position.mockRejectedValue(new Error("SECRET DB ERROR"));
  mocks.activity.mockRejectedValue(new Error("SECRET DB ERROR"));
  const report = await generateFinancialReport(client([{ security_name: "Secret partial position" }], 2) as unknown as SupabaseClient, "owner", null, now);
  expect(report.netWorth).toBeNull(); expect(report.coverageKey).toBeNull();
  expect(JSON.stringify(report)).toContain("spending totals are unavailable");
  expect(JSON.stringify(report)).not.toMatch(/Secret partial|SECRET DB ERROR/);
});
it("shows actual stored holding fields, preserving missing cost basis without deriving dates", async () => {
  const report = await generateFinancialReport(client([{ plaid_account_id: "PRIVATE-PROVIDER-ID", security_name: "Fixture stock", ticker_symbol: "FIX", quantity: 2, institution_value: 100, institution_price: 50, cost_basis: null, currency: "USD", updated_at: "2026-11-10" }]) as unknown as SupabaseClient, "owner", null, now);
  const text = report.sections.find((s) => s.title === "Investment holdings")!.lines.join(" ");
  expect(text).toContain("Quantity 2"); expect(text).toContain("Market value $100.00");
  expect(text).toContain("Cost basis Unavailable"); expect(report.netWorth).toBe(1500);
});
it("only compares compatible recorded net-worth observations", () => {
  const current = { currency: "USD", netWorth: 1500.12, coverageKey: "same" };
  const previous = { ...current, netWorth: 1000.10 } as FinancialReport;
  expect(compareReport(current, previous)).toBe(500.02);
  expect(compareReport(current, { ...previous, coverageKey: "changed" })).toBeNull();
  expect(compareReport(current, { ...previous, currency: "EUR" })).toBeNull();
  expect(compareReport(current, { ...previous, netWorth: null })).toBeNull();
  expect(compareReport(current, null)).toBeNull();
  expect(reportMoney(null, "USD")).toBe("Unavailable"); expect(reportMoney(0, "USD")).toBe("$0.00");
});
