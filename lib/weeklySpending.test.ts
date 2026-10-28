import { describe, expect, it } from "vitest";
import { calculateWeeklySpending, WeeklySpendingTransaction } from "./weeklySpending";
import { LEGACY_EXAMPLE_FINANCIAL_PROFILE, STARTER_FINANCIAL_PROFILE } from "./financialProfileDefaults";

function transaction(overrides: Partial<WeeklySpendingTransaction> = {}): WeeklySpendingTransaction {
  return {
    date: "2026-10-05",
    amount: 250,
    name: "Purchase",
    merchant_name: "Local shop",
    category: ["Shops", "Shopping"],
    ...overrides,
  };
}

function calculate(transactions: readonly WeeklySpendingTransaction[], venmoBalance = 0) {
  return calculateWeeklySpending({
    asOf: "2026-10-08",
    transactions,
    venmoBalance,
    profile: LEGACY_EXAMPLE_FINANCIAL_PROFILE,
  });
}

describe("calculateWeeklySpending", () => {
  it("keeps an unset target and dependent totals unknown for a new profile", () => {
    const result = calculateWeeklySpending({ asOf: "2026-10-08", transactions: [], venmoBalance: 0, profile: STARTER_FINANCIAL_PROFILE });
    expect(result.target).toBeNull();
    expect(result.remainingBudget).toBeNull();
    expect(result.remainingFundingNeed).toBeNull();
    expect(result.spendingPercentage).toBeNull();
  });

  it("separates the remaining budget from the Venmo funding offset", () => {
    const result = calculate([transaction()], 100);

    expect(result.eligibleSpending).toBe(250);
    expect(result.remainingBudget).toBe(170);
    expect(result.remainingFundingNeed).toBe(70);
  });

  it("counts credit-card purchases but not credit-card payments", () => {
    const result = calculate([
      transaction({ amount: 80, name: "Restaurant purchase" }),
      transaction({ amount: 200, name: "Credit Card Payment" }),
    ]);

    expect(result.eligibleSpending).toBe(80);
  });

  it("excludes transfers and investment activity", () => {
    const result = calculate([
      transaction({ amount: 50, name: "Transfer to savings", category: ["Transfer"] }),
      transaction({ amount: 75, merchant_name: "Robinhood", name: "Investment" }),
    ]);

    expect(result.eligibleSpending).toBe(0);
  });

  it("counts subscriptions", () => {
    const result = calculate([transaction({ amount: 15, name: "Netflix subscription" })]);

    expect(result.eligibleSpending).toBe(15);
  });

  it("uses Friday through Thursday boundaries", () => {
    const result = calculate([
      transaction({ date: "2026-10-02", amount: 40 }),
      transaction({ date: "2026-10-08", amount: 60 }),
      transaction({ date: "2026-10-09", amount: 100 }),
    ]);

    expect(result.periodStart).toBe("2026-10-02");
    expect(result.periodEnd).toBe("2026-10-08");
    expect(result.eligibleSpending).toBe(100);
  });

  it("does not let Venmo reduce eligible spending", () => {
    const withoutVenmo = calculate([transaction()], 0);
    const withVenmo = calculate([transaction()], 100);

    expect(withVenmo.eligibleSpending).toBe(withoutVenmo.eligibleSpending);
  });

  it("subtracts a qualifying posted incoming Venmo reimbursement", () => {
    const result = calculate([
      transaction({ amount: 250 }),
      transaction({ amount: -25, merchant_name: "Venmo", name: "Venmo payment", pending: false }),
    ]);

    expect(result.eligibleSpending).toBe(225);
  });

  it("applies refunds as a reduction when classification identifies them", () => {
    const result = calculate([
      transaction({ amount: 250 }),
      transaction({ amount: -25, name: "Refund from Local shop" }),
    ]);

    expect(result.eligibleSpending).toBe(225);
  });
});
