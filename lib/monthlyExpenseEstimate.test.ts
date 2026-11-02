import { describe, expect, it } from "vitest";
import { LEGACY_EXAMPLE_FINANCIAL_PROFILE, STARTER_FINANCIAL_PROFILE, type FinancialProfile, type RecurringExpenseProfile } from "./financialProfileDefaults";
import { normalizeFinancialProfile, validateFinancialProfileCollections } from "./financialProfileNormalization";
import { estimateMonthlyRecurringExpenses } from "./monthlyExpenseEstimate";

const expense = (overrides: Partial<RecurringExpenseProfile> = {}): RecurringExpenseProfile => ({
  name: "Fictional service", category: "utilities", amount: 120, frequency: "monthly", ...overrides,
});
const profile = (recurringExpenses: readonly RecurringExpenseProfile[], extras: Partial<FinancialProfile> = {}) => normalizeFinancialProfile({ ...STARTER_FINANCIAL_PROFILE, ...extras, recurringExpenses });

describe("estimateMonthlyRecurringExpenses", () => {
  it("sums multiple monthly recurring expenses and preserves names and categories", () => {
    const result = estimateMonthlyRecurringExpenses(profile([expense(), expense({ name: "Fictional internet", category: "communications", amount: 60 })]));
    expect(result.estimatedMonthlyExpenses).toBe(180);
    expect(result.items[0]).toMatchObject({ name: "Fictional service", category: "utilities", amount: 120, frequency: "monthly", included: true, estimatedMonthlyAmount: 120 });
  });

  it.each([
    ["weekly", 120, 520],
    ["biweekly", 120, 260],
    ["semimonthly", 120, 240],
    ["monthly", 120, 120],
    ["annual", 120, 10],
  ] as const)("converts %s expenses to monthly values", (frequency, amount, expected) => {
    expect(estimateMonthlyRecurringExpenses(profile([expense({ amount, frequency })])).estimatedMonthlyExpenses).toBe(expected);
  });

  it("keeps unknown amounts unavailable and preserves explicit zero", () => {
    const unknown = estimateMonthlyRecurringExpenses(profile([expense({ amount: undefined })]));
    const zero = estimateMonthlyRecurringExpenses(profile([expense({ amount: 0 })]));
    expect(unknown).toMatchObject({ estimatedMonthlyExpenses: null, status: "unavailable", partial: false, excludedItems: [{ exclusionReason: "unknown-amount", amount: undefined }] });
    expect(zero).toMatchObject({ estimatedMonthlyExpenses: 0, items: [{ included: true, estimatedMonthlyAmount: 0 }] });
  });

  it("excludes irregular expenses from the recurring estimate", () => {
    expect(estimateMonthlyRecurringExpenses(profile([expense({ frequency: "irregular" })])).excludedItems[0].exclusionReason).toBe("irregular-expense");
  });

  it("flags negative amounts and server-side validation rejects them", () => {
    const invalid = profile([expense({ amount: -5 })]);
    expect(estimateMonthlyRecurringExpenses(invalid).excludedItems[0]).toMatchObject({ included: false, exclusionReason: "invalid-amount" });
    expect(validateFinancialProfileCollections(invalid)["recurringExpenses.0.amount"]).toBeDefined();
  });

  it("returns a complete zero estimate for an empty configured collection", () => {
    expect(estimateMonthlyRecurringExpenses(profile([]))).toMatchObject({ configured: true, estimatedMonthlyExpenses: 0, status: "complete", includedCount: 0, recordCount: 0, includedProportion: null, complete: true, partial: false });
  });

  it("leaves legacy-only estimates unavailable and does not rewrite existing legacy amounts", () => {
    const legacyBefore = structuredClone(LEGACY_EXAMPLE_FINANCIAL_PROFILE);
    const normalized = normalizeFinancialProfile(LEGACY_EXAMPLE_FINANCIAL_PROFILE);
    expect(estimateMonthlyRecurringExpenses(normalized)).toMatchObject({ configured: false, estimatedMonthlyExpenses: null });
    expect(normalized.bills?.monthlyObligations?.total).toBe(898);
    expect(normalized.budget?.expenses).toEqual(LEGACY_EXAMPLE_FINANCIAL_PROFILE.budget?.expenses);
    expect(LEGACY_EXAMPLE_FINANCIAL_PROFILE).toEqual(legacyBefore);
  });

  it("does not treat debt balances or payments as recurring expenses", () => {
    const result = estimateMonthlyRecurringExpenses(profile([expense({ amount: 100 })], { debts: [{ name: "Fictional loan", balance: 9000, monthlyPayment: 250, minimumPayment: 200 }] }));
    expect(result.estimatedMonthlyExpenses).toBe(100);
    expect(result.items).toHaveLength(1);
  });

  it("does not add retirement contributions that may already be deducted from take-home income", () => {
    const result = estimateMonthlyRecurringExpenses(profile([expense({ amount: 100 })], {
      paychecks: { rothContribution: 300, frequency: "monthly" },
      retirementContributions: { perPaycheck: 300 },
      retirementContributionPlans: [{ name: "Fictional workplace plan", contribution: { basis: "amount", amount: 400, frequency: "monthly" } }],
    }));
    expect(result.estimatedMonthlyExpenses).toBe(100);
    expect(result.items).toHaveLength(1);
  });

  it("reports excluded records and marks the total partial", () => {
    const result = estimateMonthlyRecurringExpenses(profile([expense({ amount: 200 }), expense({ name: "Unknown bill", amount: undefined }), expense({ name: "Irregular fee", frequency: "irregular" })]));
    expect(result).toMatchObject({ estimatedMonthlyExpenses: 200, includedCount: 1, recordCount: 3, includedProportion: 1 / 3, status: "partial", complete: false, partial: true });
    expect(result.excludedItems.map((item) => item.exclusionReason)).toEqual(["unknown-amount", "irregular-expense"]);
  });

  it("excludes runtime unsupported frequency values", () => {
    const result = estimateMonthlyRecurringExpenses(profile([expense({ frequency: "other" as RecurringExpenseProfile["frequency"] })]));
    expect(result.excludedItems[0].exclusionReason).toBe("unsupported-frequency");
  });
});
