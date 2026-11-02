import { describe, expect, it } from "vitest";
import { LEGACY_EXAMPLE_FINANCIAL_PROFILE, STARTER_FINANCIAL_PROFILE, type FinancialProfile, type IncomeSource } from "./financialProfileDefaults";
import { normalizeFinancialProfile } from "./financialProfileNormalization";
import { estimateMonthlyBudgetIncome } from "./monthlyIncomeEstimate";

const source = (overrides: Partial<IncomeSource> = {}): IncomeSource => ({
  name: "Fictional job", type: "employment", amount: 1200, basis: "net", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true, ...overrides,
});
const profile = (incomeSources: readonly IncomeSource[], extras: Partial<FinancialProfile> = {}) => normalizeFinancialProfile({ ...STARTER_FINANCIAL_PROFILE, ...extras, incomeSources });

describe("estimateMonthlyBudgetIncome", () => {
  it("includes one opted-in regular net source", () => {
    expect(estimateMonthlyBudgetIncome(profile([source()])).estimatedMonthlyTakeHomeIncome).toBe(1200);
  });
  it("sums multiple opted-in net sources", () => {
    expect(estimateMonthlyBudgetIncome(profile([source(), source({ name: "Fictional benefit", amount: 300 })])).estimatedMonthlyTakeHomeIncome).toBe(1500);
  });
  it("excludes gross income", () => {
    expect(estimateMonthlyBudgetIncome(profile([source({ basis: "gross" })])).excludedSources[0].reason).toBe("gross-income");
  });
  it("excludes unknown amounts", () => {
    expect(estimateMonthlyBudgetIncome(profile([source({ amount: undefined })])).excludedSources[0].reason).toBe("unknown-amount");
  });
  it("preserves explicit zero", () => {
    expect(estimateMonthlyBudgetIncome(profile([source({ amount: 0 })])).estimatedMonthlyTakeHomeIncome).toBe(0);
  });
  it("excludes irregular income", () => {
    expect(estimateMonthlyBudgetIncome(profile([source({ regularity: "irregular", frequency: "irregular" })])).excludedSources[0].reason).toBe("irregular-income");
  });
  it("excludes opted-out sources", () => {
    expect(estimateMonthlyBudgetIncome(profile([source({ includeInBudgetEstimate: false })])).excludedSources[0].reason).toBe("not-opted-in");
  });
  it.each([
    ["weekly", 1200 * 52 / 12], ["biweekly", 1200 * 26 / 12], ["semimonthly", 2400], ["monthly", 1200], ["annual", 100],
  ] as const)("converts %s pay", (frequency, expected) => {
    expect(estimateMonthlyBudgetIncome(profile([source({ amount: 1200, frequency })])).estimatedMonthlyTakeHomeIncome).toBe(expected);
  });
  it("preserves the legacy budget calculation when collections are unconfigured", () => {
    const result = estimateMonthlyBudgetIncome(normalizeFinancialProfile(LEGACY_EXAMPLE_FINANCIAL_PROFILE));
    expect(result.estimatedMonthlyTakeHomeIncome).toBe(4240);
    expect(result.legacyFallbackUsed).toBe(true);
  });
  it("gives configured collections precedence over legacy monthly income", () => {
    const result = estimateMonthlyBudgetIncome(profile([source({ amount: 800 })], { budget: { monthlyIncome: 7000 } }));
    expect(result.estimatedMonthlyTakeHomeIncome).toBe(800);
    expect(result.legacyFallbackUsed).toBe(false);
  });
  it("does not fall back for an explicitly empty collection", () => {
    const normalized = normalizeFinancialProfile({ ...STARTER_FINANCIAL_PROFILE, incomeSources: [], budget: { monthlyIncome: 7000 } });
    expect(normalized.incomeSources).toEqual([]);
    expect(estimateMonthlyBudgetIncome(normalized)).toMatchObject({ estimatedMonthlyTakeHomeIncome: 0, legacyFallbackUsed: false, complete: true });
  });
  it("does not count legacy income twice alongside a new source", () => {
    const result = estimateMonthlyBudgetIncome(profile([source({ amount: 500 })], { income: { amount: 2500, basis: "take-home", frequency: "monthly" }, paychecks: { netAmount: 2500, frequency: "monthly" }, budget: { monthlyIncome: 2500 } }));
    expect(result.estimatedMonthlyTakeHomeIncome).toBe(500);
    expect(result.includedSources).toHaveLength(1);
  });
  it("reports excluded sources and a partial result", () => {
    const result = estimateMonthlyBudgetIncome(profile([source(), source({ name: "Gross contract", basis: "gross" })]));
    expect(result).toMatchObject({ estimatedMonthlyTakeHomeIncome: 1200, complete: false, partial: true });
    expect(result.excludedSources).toMatchObject([{ reason: "gross-income" }]);
  });
  it("keeps the legacy Richard example unchanged", () => {
    expect(LEGACY_EXAMPLE_FINANCIAL_PROFILE.budget?.monthlyIncome).toBe(4240);
    expect(LEGACY_EXAMPLE_FINANCIAL_PROFILE).not.toHaveProperty("incomeSources");
  });
});
