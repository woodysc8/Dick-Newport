import { expect, it } from "vitest";
import { calendarMonth, summarizeMonthlyActivity } from "./monthlyActivity";
import type { BudgetAccount, BudgetTransaction } from "./discretionaryBudget";

const account: BudgetAccount = { id: "a", account_name: "Checking", institution_name: "Fixture", currency: "USD", persistent_account_id: null, weekly_budget_source: "exclude", created_at: "2026-01-01", account_type: "depository" };
const row: BudgetTransaction = {
  id: "t", account_id: "a", plaid_transaction_id: "provider-t", date: "2026-11-12", name: "Fixture",
  merchant_name: null, amount: 20, pending: false, category: null, normalized_category: "needs_review",
  category_override: null, weekly_budget_override: null, transaction_currency: "USD", pending_transaction_id: null,
  plaid_primary_category: null, plaid_detailed_category: null, plaid_category_confidence: null,
};
const tx = (id: string, changes: Partial<BudgetTransaction> = {}): BudgetTransaction => ({ ...row, id, plaid_transaction_id: `provider-${id}`, ...changes });
const summarize = (rows: BudgetTransaction[], accounts = [account], selected: string | null = null) => summarizeMonthlyActivity(rows, accounts, "2026-11", selected);

it("uses complete calendar months including leap years and year transitions", () => {
  expect(calendarMonth("2024-02")).toEqual({ start: "2024-02-01", end: "2024-03-01" });
  expect(calendarMonth("2026-12").end).toBe("2027-01-01");
  const result = summarize([tx("before", { date: "2026-10-31" }), tx("first", { date: "2026-11-01" }), tx("last", { date: "2026-11-30" }), tx("after", { date: "2026-12-01" })]);
  expect(result.totalTransactions).toBe(2);
  expect(result.rows.map((r) => r.id)).toEqual(["last", "first"]);
});
it.each(["2026-00", "2026-13", "26-11", "2026-1", "bad", "9999-12"])("rejects invalid month %s", (month) => expect(() => calendarMonth(month)).toThrow());

it("includes ambiguous Venmo, legacy payments and other unknown posted debits provisionally", () => {
  const rows = [tx("venmo", { amount: 100, category: "Transfer > Third Party > Venmo", merchant_name: "Venmo" }), tx("payment", { category: "Payment > Credit Card", amount: 50 }), tx("unknown", { amount: 12.34 })];
  const before = structuredClone(rows);
  const result = summarize(rows);
  expect(result.postedPurchases).toBe(162.34);
  expect(result.unverifiedDebits).toBe(162.34);
  expect(result.confirmedPurchases).toBe(0);
  expect(result.provisional).toBe(true);
  expect(result.totalTransactions).toBe(3);
  expect(rows).toEqual(before);
});

it("excludes corroborated legacy Bilt payments and investment funding with a transparent posted breakdown", () => {
  const result = summarize([
    tx("bilt", { category: "Payment > Credit Card", name: "BILT CARD PMT ***********", amount: 150 }),
    tx("barclays", { category: "Payment > Credit Card", name: "BARCLAYCARD US CREDITCARD", merchant_name: "Barclays", amount: 50 }),
    tx("broker", { category: "Service > Financial > Stock Brokers", name: "Robinhood", merchant_name: "Robinhood", amount: 500 }),
    tx("venmo", { category: "Transfer > Third Party > Venmo", name: "Venmo", amount: 40 }),
    tx("pending-bilt", { category: "Payment > Credit Card", name: "BILT CARD PMT ***********", amount: 10, pending: true }),
  ]);
  expect(result.postedPurchases).toBe(40);
  expect(result.unverifiedDebits).toBe(40);
  expect(result.movementBreakdown).toEqual({ cardPayments: 200, investmentTransfers: 500, internalTransfers: 0, other: 0 });
  expect(result.rows.find((r) => r.id === "bilt")!.purposeReason).toContain("legacy");
});

it("requires corroborating legacy metadata, bank direction and no stronger contradictory evidence", () => {
  const broker = tx("broker", { category: "Service > Financial > Stock Brokers", name: "Robinhood", merchant_name: "Robinhood" });
  const bilt = tx("bilt", { category: "Payment > Credit Card", name: "BILT CARD PMT ***********" });
  expect(summarize([{ ...bilt, category: null }]).unverifiedDebits).toBe(20);
  expect(summarize([bilt], [{ ...account, account_type: "credit" }]).unverifiedDebits).toBe(20);
  expect(summarize([{ ...broker, name: "Robinhood monthly fee" }]).unverifiedDebits).toBe(20);
  expect(summarize([{ ...broker, name: "Robinhood withdrawal" }]).unverifiedDebits).toBe(20);
  expect(summarize([{ ...broker, amount: -20 }]).postedPurchases).toBe(0);
  expect(summarize([{ ...bilt, category_override: "shopping" }]).postedPurchases).toBe(20);
  expect(summarize([{ ...bilt, plaid_primary_category: "FOOD_AND_DRINK", plaid_detailed_category: "FOOD_AND_DRINK_GROCERIES", plaid_category_confidence: "HIGH" }]).confirmedPurchases).toBe(20);
  expect(summarize([{ ...bilt, plaid_primary_category: "TRANSFER_OUT", plaid_detailed_category: "FOOD_AND_DRINK_GROCERIES", plaid_category_confidence: "HIGH" }]).unverifiedDebits).toBe(20);
});

it("counts all sources independently of old budget exclusions and includes essential purchases and rent", () => {
  const a2 = { ...account, id: "b", weekly_budget_source: "review" as const };
  const result = summarize([tx("rent", { category_override: "housing", amount: 733, weekly_budget_override: "exclude", monthly_budget_override: "exclude" }), tx("health", { category_override: "healthcare", account_id: "b", amount: 50 })], [account, a2]);
  expect(result.postedPurchases).toBe(783);
  expect(result.confirmedPurchases).toBe(783);
  expect(result.totalTransactions).toBe(2);
  expect(summarize([tx("a"), tx("b", { account_id: "b", amount: 50 })], [account, a2], "b").postedPurchases).toBe(50);
});

it.each(["transfer", "card_payment", "investment", "savings", "debt_payment"] as const)("excludes manually verified %s movements from purchases while preserving list rows", (category_override) => {
  const result = summarize([tx("purchase", { category_override: "groceries" }), tx("movement", { category_override, amount: 500 })]);
  expect(result.postedPurchases).toBe(20);
  expect(result.excludedMovements).toBe(500);
  expect(result.totalTransactions).toBe(2);
});

it.each([
  ["TRANSFER_OUT", "TRANSFER_OUT_ACCOUNT_TRANSFER"],
  ["TRANSFER_OUT", "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS"],
  ["LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"],
])("excludes verified modern movement %s / %s", (plaid_primary_category, plaid_detailed_category) => {
  const modern = tx("movement", { plaid_primary_category, plaid_detailed_category, plaid_category_confidence: "HIGH" });
  expect(summarize([modern]).postedPurchases).toBe(0);
  expect(summarize([{ ...modern, category_override: "dining" }]).postedPurchases).toBe(20);
  expect(summarize([{ ...modern, plaid_category_confidence: "LOW" }]).unverifiedDebits).toBe(20);
});

it("does not turn broad or contradictory transfer metadata into a verified exclusion", () => {
  const result = summarize([tx("broad", { plaid_primary_category: "TRANSFER_OUT", plaid_detailed_category: "TRANSFER_OUT_OTHER_TRANSFER_OUT", plaid_category_confidence: "HIGH" }), tx("conflict", { plaid_primary_category: "FOOD_AND_DRINK", plaid_detailed_category: "TRANSFER_OUT_ACCOUNT_TRANSFER", plaid_category_confidence: "HIGH" })]);
  expect(result.postedPurchases).toBe(40);
  expect(result.excludedMovements).toBe(0);
});

it("keeps income, refunds and incoming transfers separate without netting purchases", () => {
  const result = summarize([tx("purchase", { amount: 100, category_override: "shopping" }), tx("income", { amount: -2000, category_override: "income" }), tx("refund", { amount: -20, name: "Refund", category_override: "shopping" }), tx("transfer", { amount: -500, category_override: "transfer" })]);
  expect(result.postedPurchases).toBe(100);
  expect(result.totalTransactions).toBe(4);
  expect(result.rows.filter((r) => r.purpose === "incoming")).toHaveLength(3);
});

it("removes proven duplicates and replaced pending records without merging equal legitimate purchases", () => {
  const rows = [tx("pending", { pending: true }), tx("posted", { pending_transaction_id: "provider-pending", amount: 22 }), tx("duplicate", { plaid_transaction_id: "provider-posted", amount: 22 }), tx("distinct", { amount: 22 }), tx("still-pending", { amount: 10, pending: true })];
  const result = summarize(rows);
  expect(result.totalTransactions).toBe(3);
  expect(result.postedPurchases).toBe(44);
  expect(result.pendingPurchases).toBe(10);
  expect(result.omittedDuplicates).toBe(2);
  expect(result.rows.some((r) => r.id === "pending")).toBe(false);
});

it("suppresses pending records posted in a different calendar month", () => {
  const result = summarizeMonthlyActivity([tx("pending", { pending: true, date: "2026-11-30" })], [account], "2026-11", null, [{ account_id: "a", pending_transaction_id: "provider-pending" }]);
  expect(result.totalTransactions).toBe(0);
  expect(result.pendingPurchases).toBe(0);
});

it("includes every durable-account source, withholds unreconciled totals, and groups account filters", () => {
  const a = { ...account, persistent_account_id: "same-bank-account" }, b = { ...a, id: "b", created_at: "2026-02-01" };
  const rows = [tx("first"), tx("duplicate", { account_id: "b" })];
  const result = summarize(rows, [b, a], "b");
  expect(result.postedPurchases).toBeNull();
  expect(result.totalTransactions).toBe(2);
  expect(result.unresolvedRepeatedSources).toBe(1);
  expect(result.repeatedSources).toBe(1);
  expect(result.selectedAccountId).toBe("a");
  expect(result.provisional).toBe(true);
  const proven = summarize([rows[0], { ...rows[1], plaid_transaction_id: rows[0].plaid_transaction_id }], [a, b]);
  expect(proven.totalTransactions).toBe(1);
  expect(proven.postedPurchases).toBe(20);
});

it("withholds mixed-currency/missing-amount totals and labels unknown posting status", () => {
  expect(summarize([tx("usd"), tx("eur", { transaction_currency: "EUR" })]).postedPurchases).toBeNull();
  expect(summarize([tx("invalid", { amount: "" })]).postedPurchases).toBeNull();
  expect(summarize([tx("invalid", { transaction_currency: "INVALID" })]).rows[0].currency).toBeNull();
  const result = summarize([tx("unknown-status", { pending: null })]);
  expect(result.unknownStatusCount).toBe(1);
  expect(result.postedPurchases).toBeNull();
  expect(result.provisional).toBe(true);
});
