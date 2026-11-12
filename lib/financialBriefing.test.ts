import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { financialBudget } from "./budgetEngine";
import { loadFinancialBudget, type FinancialSnapshot } from "./financialBudgetData";
import { generateBriefing } from "./financialBriefing";
import type { BudgetTransaction } from "./discretionaryBudget";

const now = new Date("2026-11-12T17:00:00Z");
const account = {
  id: "private-account-id", persistent_account_id: "private-durable-id",
  account_name: "Account 123456789", institution_name: "Fixture", currency: "USD",
  weekly_budget_source: "include" as const, created_at: "2026-01-01",
  account_type: "depository", current_balance: 1000,
};
const transaction: BudgetTransaction = {
  id: "private-transaction-id", account_id: account.id, plaid_transaction_id: "provider-private-id",
  date: "2026-11-12", name: "Merchant 123456789", merchant_name: null, amount: 527.26,
  pending: false, category: null, normalized_category: "needs_review", category_override: null,
  weekly_budget_override: null, transaction_currency: "USD", pending_transaction_id: null,
  plaid_primary_category: null, plaid_detailed_category: null, plaid_category_confidence: null,
};
function snapshot(overrides: Partial<FinancialSnapshot> = {}): FinancialSnapshot {
  return {
    user_id: "owner", transactions: [transaction], accounts: [account],
    weekly_limit: 420, monthly_limit: null, category_rules: [], account_rules: [],
    sync_in_progress: false, jobs: [], ...overrides,
  };
}
function briefing(s = snapshot()): Awaited<ReturnType<typeof loadFinancialBudget>> {
  return {
    ...financialBudget(s.transactions, s.accounts, s.weekly_limit, undefined, now),
    policy: { categories: [], accounts: [], monthly_limit: null }, snapshot: s,
    planning: null, stale: true, lastSync: null, briefingDetails: null,
  };
}

it("exports engine exposure without declaring unclassified debits confirmed or safe", () => {
  const data = briefing();
  expect(data.weekly.posted).toBe(0);
  expect(data.weekly.conservativeRemaining).toBe(-107.26);
  const { text } = generateBriefing(data, now);
  expect(text).toContain("pending projected $0.00");
  expect(text).toContain("Needs review 1 ($527.26)");
  expect(text).toContain("-$107.26");
  expect(text).toContain("not a safe-to-spend allowance");
  expect(text).toContain("$1,820.00");
  for (const privateValue of [account.id, account.persistent_account_id, transaction.id, transaction.plaid_transaction_id!, "123456789"])
    expect(text).not.toContain(privateValue);
});

it("bounds unclassified review to 15 and labels configured dates as unverified", () => {
  const s = snapshot({ transactions: Array.from({ length: 20 }, (_, i) => ({ ...transaction, id: `private-${i}`, plaid_transaction_id: null })),
    planning_profile: { label: "Private", currency: "USD", paychecks: { paydays: ["2026-11-13"], netAmount: 1900 }, recurringExpenses: [{ name: "Rent", amount: 733, frequency: "monthly", dueDate: "2026-12-01" }] } });
  const { text } = generateBriefing(briefing(s), now);
  const section = text.split("UNCLASSIFIED TRANSACTION REVIEW")[1].split("RECENT TRANSACTIONS")[0];
  expect(section.match(/suggestion:/g)).toHaveLength(15);
  expect(text).toContain("Next verified paycheck date: unavailable");
  expect(text).toContain("Next configured payday: 2026-11-13");
  expect(text).toContain("funding account unavailable");
});

it("includes non-budget investment accounts once and distinguishes missing holdings", () => {
  const investment = { ...account, id: "investment", persistent_account_id: "investment-durable", account_type: "investment", current_balance: 20901, weekly_budget_source: "exclude" as const };
  const data = briefing(snapshot({ accounts: [account, investment, { ...investment, id: "duplicate" }] }));
  const { text } = generateBriefing(data, now);
  expect(text).toContain("investments $20,901.00");
  expect(text).toContain("duplicate records omitted");
  expect(text).toContain("Individual holdings query unavailable");
  expect(text).toContain("Verified Roth IRA contributions unavailable");
});

it("scopes supplementary detail reads to the owner, bounds them, and preserves errors", async () => {
  const queries: Record<string, ReturnType<typeof vi.fn>>[] = [];
  const from = vi.fn(() => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const key of ["select", "eq", "order"]) query[key] = vi.fn(() => query);
    query.limit = vi.fn(async () => ({ data: null, error: { message: "private DB details" } }));
    queries.push(query);
    return query;
  });
  const rpc = vi.fn().mockResolvedValue({ data: snapshot(), error: null });
  const data = await loadFinancialBudget({ rpc, from } as unknown as SupabaseClient, "owner", now, false, true);
  expect(from.mock.calls).toHaveLength(2);
  for (const q of queries) expect(q.eq).toHaveBeenCalledWith("user_id", "owner");
  expect(queries[0].limit).toHaveBeenCalledWith(501);
  expect(queries[1].limit).toHaveBeenCalledWith(201);
  expect(data.briefingDetails).toEqual({ accounts: null, holdings: null });
  expect(generateBriefing(data, now).text).not.toContain("private DB details");
});

it("exports recorded holdings and credit without adding review debits to card balances", () => {
  const data = briefing(snapshot({ accounts: [{ ...account, account_type: "credit", current_balance: 200 }] }));
  data.briefingDetails = {
    accounts: [{ ...account, account_type: "credit", account_subtype: "credit card", current_balance: 200, available_balance: 0, mask: null }],
    holdings: [{ id: "private-holding-id", plaid_account_id: "private-provider-id", security_id: "private-security-id", ticker_symbol: "VTI", security_name: "Fund 1234-5678-9012", quantity: 2, institution_price: 100, institution_value: 200, cost_basis: 150, currency: "USD" }],
  };
  const { text } = generateBriefing(data, now);
  expect(text).toContain("recorded balance $200.00 | available credit $0.00");
  expect(text).not.toContain("$727.26");
  expect(text).toContain("ticker VTI | value $200.00 | cost basis $150.00");
  expect(text).toContain("minimum payment and APR unavailable");
  for (const raw of ["private-provider-id", "private-security-id", "private-holding-id", "1234-5678-9012"])
    expect(text).not.toContain(raw);
});

it("rejects a mismatched snapshot owner before supplementary reads", async () => {
  const from = vi.fn();
  const rpc = vi.fn().mockResolvedValue({ data: snapshot({ user_id: "other" }), error: null });
  await expect(loadFinancialBudget({ rpc, from } as unknown as SupabaseClient, "owner", now, false, true)).rejects.toThrow("Financial snapshot unavailable");
  expect(from).not.toHaveBeenCalled();
});
