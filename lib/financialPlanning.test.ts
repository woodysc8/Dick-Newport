import { describe, expect, it } from "vitest";
import { STARTER_FINANCIAL_PROFILE, type FinancialProfile } from "./financialProfileDefaults";
import { calculateFinancialPlanning } from "./financialPlanning";

const completeProfile: FinancialProfile = {
  ...STARTER_FINANCIAL_PROFILE,
  incomeSources: [{ name: "Salary", type: "employment", amount: 5000, basis: "net", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true }],
  recurringExpenses: [{ name: "Rent", amount: 1500, frequency: "monthly" }],
  debts: [{ name: "Loan", minimumPayment: 250, paymentFrequency: "monthly", balance: 10000 }],
  savingsAllocations: [{ name: "Emergency fund", amount: 500, frequency: "monthly" }],
  retirementContributionPlans: [{ name: "401k", contribution: { basis: "amount", amount: 400, frequency: "monthly" } }],
  budget: { monthlySpendingTarget: 2000 },
  goals: [{ name: "Reserve", targetAmount: 12000, targetDate: "2027-01-01" }],
};

describe("calculateFinancialPlanning", () => {
  it("calculates complete generalized planning data without subtracting retirement", () => {
    const result = calculateFinancialPlanning(completeProfile, { actualMonthlySpending: 1000 });
    expect(result.remainingMonthlyCash).toBe(2750);
    expect(result.retirementContributions.monthlyAmount).toBe(400);
    expect(result.retirementContributions.excludedFromRemainingCash).toBe(true);
    expect(result.budgetUtilization).toBe(50);
    expect(result.goals[0]).toMatchObject({ targetAmount: 12000, targetDate: "2027-01-01", progress: null });
    expect(result.complete).toBe(true);
  });

  it("keeps an empty profile unavailable rather than treating missing values as zero", () => {
    const result = calculateFinancialPlanning(STARTER_FINANCIAL_PROFILE);
    expect(result.remainingMonthlyCash).toBeNull();
    expect(result.income.estimatedMonthlyTakeHomeIncome).toBeNull();
    expect(result.debtPayments.monthlyAmount).toBeNull();
    expect(result.savingsAllocations.monthlyAmount).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.status).toBe("unavailable");
  });

  it("preserves explicit zero income, expenses, debt payments, and savings", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      incomeSources: [{ ...completeProfile.incomeSources![0], amount: 0 }],
      recurringExpenses: [],
      debts: [],
      savingsAllocations: [],
    });
    expect(result.income.estimatedMonthlyTakeHomeIncome).toBe(0);
    expect(result.recurringExpenses.estimatedMonthlyExpenses).toBe(0);
    expect(result.debtPayments.monthlyAmount).toBe(0);
    expect(result.savingsAllocations.monthlyAmount).toBe(0);
    expect(result.remainingMonthlyCash).toBe(0);
    expect(result.status).toBe("complete");
  });

  it("converts multiple debt frequencies and does not use debt balances as payments", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      debts: [
        { name: "Weekly", balance: 10000, minimumPayment: 100, paymentFrequency: "weekly" },
        { name: "Annual", balance: 10000, minimumPayment: 1200, paymentFrequency: "annual" },
      ],
    });
    expect(result.debtPayments.monthlyAmount).toBeCloseTo(533.3333333333);
  });

  it("converts multiple savings frequencies", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      savingsAllocations: [
        { name: "Weekly", amount: 100, frequency: "weekly" },
        { name: "Biweekly", amount: 100, frequency: "biweekly" },
      ],
    });
    expect(result.savingsAllocations.monthlyAmount).toBeCloseTo(650);
  });

  it("reports missing debt payments and unsupported savings frequencies", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      debts: [{ name: "Unknown debt", balance: 1000 }],
      savingsAllocations: [{ name: "Paycheck reserve", amount: 100, frequency: "per-paycheck" }],
    });
    expect(result.debtPayments.monthlyAmount).toBeNull();
    expect(result.debtPayments.excludedItems[0].reason).toMatch(/minimum payment|frequency/);
    expect(result.savingsAllocations.monthlyAmount).toBeNull();
    expect(result.savingsAllocations.excludedItems[0].reason).toMatch(/per-paycheck/);
    expect(result.remainingMonthlyCash).toBeNull();
  });

  it("reports partial income and expense data without inventing totals", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      incomeSources: [{ ...completeProfile.incomeSources![0], basis: "gross" }],
      recurringExpenses: [{ name: "Unknown", frequency: "monthly" }],
    });
    expect(result.income.estimatedMonthlyTakeHomeIncome).toBeNull();
    expect(result.income.status).toBe("unavailable");
    expect(result.recurringExpenses.estimatedMonthlyExpenses).toBeNull();
    expect(result.remainingMonthlyCash).toBeNull();
  });

  it("allows negative remaining cash when commitments exceed income", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      incomeSources: [{ ...completeProfile.incomeSources![0], amount: 1000 }],
      recurringExpenses: [{ name: "Rent", amount: 900, frequency: "monthly" }],
      debts: [{ name: "Loan", minimumPayment: 300, paymentFrequency: "monthly" }],
      savingsAllocations: [{ name: "Savings", amount: 100, frequency: "monthly" }],
    });
    expect(result.remainingMonthlyCash).toBe(-300);
  });

  it("keeps missing targets and actual-spending utilization unavailable", () => {
    const withoutTarget = calculateFinancialPlanning({ ...completeProfile, budget: {} });
    expect(withoutTarget.discretionarySpendingTarget).toBeNull();
    expect(withoutTarget.budgetUtilization).toBeNull();
    expect(withoutTarget.budgetUtilizationReason).toMatch(/actual spending/);

    const withTarget = calculateFinancialPlanning(completeProfile, { actualMonthlySpending: 0 });
    expect(withTarget.budgetUtilization).toBe(0);

    const zeroTarget = calculateFinancialPlanning({ ...completeProfile, budget: { monthlySpendingTarget: 0 } }, { actualMonthlySpending: 25 });
    expect(zeroTarget.budgetUtilization).toBeNull();
    expect(zeroTarget.budgetUtilizationReason).toMatch(/zero/);
  });

  it("does not double-count legacy income, debt payment, or retirement fields", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      income: { amount: 9000, basis: "take-home", frequency: "monthly" },
      budget: { monthlyIncome: 9000, monthlySpendingTarget: 2000 },
      paychecks: { netAmount: 9000, rothContribution: 900 },
      retirementContributions: { perPaycheck: 900 },
      debts: [{ name: "Loan", balance: 10000, minimumPayment: 250, paymentFrequency: "monthly", monthlyPayment: 900 }],
    });
    expect(result.income.estimatedMonthlyTakeHomeIncome).toBe(5000);
    expect(result.debtPayments.monthlyAmount).toBe(250);
    expect(result.retirementContributions.monthlyAmount).toBe(400);
  });

  it("keeps all-excluded income unavailable and mixed income as a partial subtotal", () => {
    const excluded = calculateFinancialPlanning({
      ...completeProfile,
      incomeSources: [{ ...completeProfile.incomeSources![0], basis: "gross" }],
    });
    expect(excluded.income.estimatedMonthlyTakeHomeIncome).toBeNull();
    expect(excluded.income.status).toBe("unavailable");
    expect(excluded.remainingMonthlyCash).toBeNull();

    const mixed = calculateFinancialPlanning({
      ...completeProfile,
      incomeSources: [
        completeProfile.incomeSources![0],
        { ...completeProfile.incomeSources![0], name: "Invalid", amount: -1 },
      ],
    });
    expect(mixed.income.estimatedMonthlyTakeHomeIncome).toBe(5000);
    expect(mixed.income.status).toBe("partial");
    expect(mixed.status).toBe("partial");
  });

  it("distinguishes missing and explicitly empty collections", () => {
    const missing = calculateFinancialPlanning(STARTER_FINANCIAL_PROFILE);
    expect(missing.debtPayments.status).toBe("unavailable");
    expect(missing.savingsAllocations.status).toBe("unavailable");

    const empty = calculateFinancialPlanning({
      ...completeProfile,
      debts: [],
      savingsAllocations: [],
    });
    expect(empty.debtPayments).toMatchObject({ status: "complete", monthlyAmount: 0, amountMeaning: "complete" });
    expect(empty.savingsAllocations).toMatchObject({ status: "complete", monthlyAmount: 0, amountMeaning: "complete" });
  });

  it("marks mixed debt and savings amounts as known subtotals", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      debts: [
        { name: "Known", minimumPayment: 100, paymentFrequency: "monthly" },
        { name: "Unknown", balance: 1000 },
      ],
      savingsAllocations: [
        { name: "Known", amount: 100, frequency: "monthly" },
        { name: "Unknown", amount: 100 },
      ],
    });
    expect(result.debtPayments).toMatchObject({ status: "partial", knownMonthlyAmount: 100, amountMeaning: "known-subtotal" });
    expect(result.savingsAllocations).toMatchObject({ status: "partial", knownMonthlyAmount: 100, amountMeaning: "known-subtotal" });
  });

  it.each([-1, 101, Number.NaN, Number.POSITIVE_INFINITY])("rejects retirement percentage %s", (percentage) => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      retirementContributionPlans: [{
        name: "Invalid retirement",
        contribution: { basis: "percentage", percentage, percentageOf: "net-income" },
      }],
    });
    expect(result.retirementContributions.status).toBe("unavailable");
    expect(result.retirementContributions.excludedItems).toHaveLength(1);
    expect(result.status).toBe("partial");
  });

  it("keeps retirement-only incompleteness from reporting a complete result", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      retirementContributionPlans: [{
        name: "Unknown retirement",
        contribution: { basis: "percentage", percentageOf: "gross-income" },
      }],
    });
    expect(result.retirementContributions.status).toBe("unavailable");
    expect(result.status).toBe("partial");
    expect(result.complete).toBe(false);
    expect(result.partial).toBe(true);
  });

  it("identifies invalid goal amounts and dates without calculating progress", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      goals: [
        { name: "Bad amount", targetAmount: -1, targetDate: "2027-01-01" },
        { name: "Bad date", targetAmount: 1000, targetDate: "2027-02-29" },
      ],
    });
    expect(result.goals[0]).toMatchObject({ status: "unavailable", progress: null });
    expect(result.goals[0].excludedItems[0].reason).toMatch(/amount/);
    expect(result.goals[1]).toMatchObject({ status: "unavailable", progress: null });
    expect(result.goals[1].excludedItems[0].reason).toMatch(/date/);
  });

  it("rejects runtime frequencies outside the supported union", () => {
    const result = calculateFinancialPlanning({
      ...completeProfile,
      debts: [{ name: "Malformed", minimumPayment: 100, paymentFrequency: "quarterly" as never }],
      savingsAllocations: [{ name: "Malformed", amount: 100, frequency: "quarterly" as never }],
    });
    expect(result.debtPayments.status).toBe("unavailable");
    expect(result.savingsAllocations.status).toBe("unavailable");
    expect(result.remainingMonthlyCash).toBeNull();
  });
});
