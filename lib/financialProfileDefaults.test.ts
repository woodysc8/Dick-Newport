import { describe, expect, it } from "vitest";
import { getCurrentOrNextPlannedPaycheck, getPaycheckAllocation } from "./financialPlan";
import { STARTER_FINANCIAL_PROFILE } from "./financialProfileDefaults";
import { getBudgetedExpenses, getBudgetedIncome, getBudgetedSavings, getMonthlyBudget } from "./budget";

describe("configurable financial profile calculations", () => {
  it("uses the blank starter profile for calculations when no profile is supplied", () => {
    expect(getCurrentOrNextPlannedPaycheck("2026-10-01")).toBeNull();
    expect(getPaycheckAllocation()).toEqual({});
    expect(getMonthlyBudget(2026, 10).lines).toEqual([]);
  });

  it("produces paycheck plans from each supplied profile", () => {
    const one = { ...STARTER_FINANCIAL_PROFILE, paychecks: { netAmount: 1200, paydays: ["2026-11-01"], rothContribution: 100 } };
    const two = { ...STARTER_FINANCIAL_PROFILE, paychecks: { netAmount: 2400, paydays: ["2026-11-01"], rothContribution: 300 } };

    expect(getCurrentOrNextPlannedPaycheck("2026-10-31", one)).toMatchObject({ netAmount: 1200, rothContribution: 100 });
    expect(getCurrentOrNextPlannedPaycheck("2026-10-31", two)).toMatchObject({ netAmount: 2400, rothContribution: 300 });
  });

  it("builds monthly budget lines and totals from independent inputs", () => {
    const first = getMonthlyBudget(2026, 10, { monthlyIncome: 3000, expenses: [{ name: "Rent", category: "housing_bills", amount: 1000 }] });
    const second = getMonthlyBudget(2026, 10, { monthlyIncome: 5000, expenses: [{ name: "Rent", category: "housing_bills", amount: 1800 }] });

    expect([getBudgetedIncome(first), getBudgetedExpenses(first), getBudgetedSavings(first)]).toEqual([3000, 1000, 2000]);
    expect([getBudgetedIncome(second), getBudgetedExpenses(second), getBudgetedSavings(second)]).toEqual([5000, 1800, 3200]);
    expect(first.lines.find((line) => line.isIncome)?.isSavings).toBe(false);
    expect(second.lines.find((line) => line.isSavings)?.isIncome).toBe(false);
  });

  it("preserves unknown budget values and distinguishes them from explicitly entered zero", () => {
    const blank = getMonthlyBudget(2026, 10, {});
    expect(blank.lines).toEqual([]);
    expect([getBudgetedIncome(blank), getBudgetedExpenses(blank), getBudgetedSavings(blank)]).toEqual([null, null, null]);

    const explicitZero = getMonthlyBudget(2026, 10, { monthlyIncome: 0, expenses: [] });
    expect([getBudgetedIncome(explicitZero), getBudgetedExpenses(explicitZero), getBudgetedSavings(explicitZero)]).toEqual([0, 0, 0]);
  });
});
