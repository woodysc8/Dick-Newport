import { describe, expect, it } from "vitest";
import { classifyTransaction, suggestTransactionClassification } from "./transactionClassification";
import { financialBudget } from "./budgetEngine";
import type { BudgetAccount, BudgetTransaction } from "./discretionaryBudget";

const account: BudgetAccount = { id: "a", account_name: "Checking", institution_name: "Fixture", currency: "USD", persistent_account_id: null, weekly_budget_source: "include", created_at: "2026-01-01", account_type: "depository" };
const row: BudgetTransaction = {
  id: "t", account_id: "a", plaid_transaction_id: "provider-t", date: "2026-11-12", name: "Fixture",
  merchant_name: null, amount: 20, pending: false, category: null, normalized_category: "needs_review",
  category_override: null, weekly_budget_override: null, transaction_currency: "USD", pending_transaction_id: null,
  plaid_primary_category: null, plaid_detailed_category: null, plaid_category_confidence: null,
};
describe("read-only classification suggestions", () => {
  it.each([
    ["Payment > Credit Card", 20, "depository", "card_payment", "medium"],
    ["Payment > Credit Card", -20, "credit", "card_payment", "medium"],
    ["Payment > Credit Card", -20, "depository", "card_payment", "low"],
    ["Payment > Credit Card", 20, "credit", "card_payment", "low"],
    ["Payment > Rent", 20, "depository", "housing", "medium"],
    ["Food and Drink > Restaurants", 20, "credit", "dining", "medium"],
    ["Food and Drink > Restaurants", -20, "credit", "dining", "low"],
    ["Transfer > Third Party > Venmo", 20, "depository", "needs_review", "needs_review"],
    ["Transfer > Third Party > Venmo", -20, "depository", "needs_review", "needs_review"],
    ["Transfer > Credit", -20, "depository", "needs_review", "needs_review"],
    ["Payment", 20, "depository", "needs_review", "needs_review"],
    ["Transfer > Payroll", -20, "depository", "income", "medium"],
    ["Transfer > Payroll", 20, "depository", "needs_review", "needs_review"],
    ["Transfer > Payroll", -20, "credit", "needs_review", "needs_review"],
    ["Service > Financial > Stock Brokers", 20, "depository", "investment", "medium"],
    ["Service > Financial > Stock Brokers", -20, "depository", "investment", "medium"],
    ["Service > Financial > Stock Brokers", 20, "credit", "investment", "low"],
    ["Shops > Pharmacies", 20, "credit", "needs_review", "needs_review"],
    ["Travel > Car Service > Ride Share", 20, "credit", "needs_review", "needs_review"],
    ["Entertainment", 20, "credit", "needs_review", "needs_review"],
  ] as const)("maps only supported exact legacy evidence: %s / %s / %s", (category, amount, type, proposed, confidence) => {
    const suggestion = suggestTransactionClassification({ ...row, category, amount }, type);
    expect(suggestion).toMatchObject({ category: proposed, confidence, evidence: "legacy_plaid", requiresApproval: true });
    expect(suggestion.weeklyIncludedByDefault).toBe(proposed === "needs_review" ? null : proposed === "dining");
    if (category.startsWith("Transfer") || category.includes("Credit Card") || category.includes("Stock Brokers")) expect(suggestion.movementRisk).toBeTruthy();
  });
  it("preserves stronger manual/modern evidence over conflicting legacy text and merchants", () => {
    const t = { ...row, category: "Payment > Credit Card", merchant_name: "Bagel Express", plaid_primary_category: "FOOD_AND_DRINK", plaid_detailed_category: "FOOD_AND_DRINK_GROCERIES", plaid_category_confidence: "HIGH" };
    expect(suggestTransactionClassification(t, "depository")).toMatchObject({ category: "groceries", evidence: "modern_plaid", confidence: "high" });
    expect(suggestTransactionClassification({ ...t, category_override: "housing" }, "depository")).toMatchObject({ category: "housing", evidence: "user_override", requiresApproval: false });
  });
  it("keeps ambiguous legacy evidence above a weak merchant guess", () => {
    expect(suggestTransactionClassification({ ...row, category: "Transfer > Third Party > Venmo", merchant_name: "Bagel Express" }, "depository").category).toBe("needs_review");
    expect(suggestTransactionClassification({ ...row, merchant_name: "Bagel Express" }, "depository")).toMatchObject({ category: "dining", confidence: "medium", evidence: "merchant_rule" });
    expect(suggestTransactionClassification({ ...row, category: "Unknown > Restaurants" }, "credit").category).toBe("needs_review");
  });
  it.each([null, "", "not-a-number", 0])("does not trust unsupported amount %s", (amount) => {
    expect(suggestTransactionClassification({ ...row, amount, category: "Payment > Rent" }, "depository").confidence).toBe("low");
  });
  it("requires review for refunds, unknown account/status, and missing metadata", () => {
    const refund = suggestTransactionClassification({ ...row, category: "Food and Drink > Restaurants", amount: -5 }, "credit");
    expect(refund.movementRisk).toContain("refund");
    expect(refund.requiresApproval).toBe(true);
    expect(suggestTransactionClassification({ ...row, category: "Payment > Rent" }).confidence).toBe("low");
    expect(suggestTransactionClassification({ ...row, pending: null, category: "Payment > Rent" }, "depository").confidence).toBe("low");
    expect(suggestTransactionClassification(row, "depository")).toMatchObject({ category: "needs_review", evidence: "insufficient_evidence" });
    expect(suggestTransactionClassification({ ...row, pending: true, category: "Payment > Rent" }, "depository").reason).toContain("Pending activity");
  });
  it("supports original legacy arrays and does not fall back on conflicting modern metadata", () => {
    const category = ["Payment", "Rent"] as unknown as string;
    expect(suggestTransactionClassification({ ...row, category }, "depository").category).toBe("housing");
    expect(suggestTransactionClassification({ ...row, category: "Payment > Rent", plaid_primary_category: "TRANSFER_OUT", plaid_detailed_category: "FOOD_AND_DRINK_COFFEE", plaid_category_confidence: "HIGH" }, "depository").category).toBe("needs_review");
  });
  it("leaves stored fields, overrides and existing financial results unchanged", () => {
    const t = Object.freeze({ ...row, category: "Food and Drink > Restaurants", weekly_budget_override: "exclude" as const });
    const before = financialBudget([t], [account], 420, undefined, new Date("2026-11-12T17:00:00Z"));
    expect(suggestTransactionClassification(t, "depository").category).toBe("dining");
    expect(classifyTransaction(t).category).toBe("needs_review");
    expect(financialBudget([t], [account], 420, undefined, new Date("2026-11-12T17:00:00Z"))).toEqual(before);
    expect(t.weekly_budget_override).toBe("exclude");
    expect(t.normalized_category).toBe("needs_review");
    expect(before.weekly.limit).toBe(420);
  });
});
