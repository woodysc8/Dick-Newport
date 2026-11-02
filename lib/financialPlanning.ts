import type {
  DebtProfile,
  FinancialGoalProfile,
  FinancialProfile,
  RetirementContributionProfile,
  SavingsAllocationProfile,
} from "./financialProfileDefaults";
import { estimateMonthlyBudgetIncome, toMonthlyIncome } from "./monthlyIncomeEstimate";
import { estimateMonthlyRecurringExpenses } from "./monthlyExpenseEstimate";

export type CalculationStatus = "complete" | "partial" | "unavailable";

export type PlanningExclusion = {
  name: string;
  reason: string;
};

export type MonthlyPlanningComponent = {
  configured: boolean;
  monthlyAmount: number | null;
  knownMonthlyAmount: number | null;
  amountMeaning: "complete" | "known-subtotal" | null;
  status: CalculationStatus;
  complete: boolean;
  partial: boolean;
  excludedItems: PlanningExclusion[];
};

export type RetirementPlanningComponent = MonthlyPlanningComponent & {
  excludedFromRemainingCash: true;
};

export type FinancialGoalSummary = {
  name: string;
  targetAmount?: number;
  targetDate?: string;
  status: CalculationStatus;
  excludedItems: PlanningExclusion[];
  progress: null;
  progressReason: "no-explicit-funding-relationship";
};

export type FinancialPlanningSummary = {
  income: ReturnType<typeof estimateMonthlyBudgetIncome>;
  recurringExpenses: ReturnType<typeof estimateMonthlyRecurringExpenses>;
  debtPayments: MonthlyPlanningComponent;
  savingsAllocations: MonthlyPlanningComponent;
  retirementContributions: RetirementPlanningComponent;
  remainingMonthlyCash: number | null;
  remainingMonthlyCashReason?: string;
  discretionarySpendingTarget: number | null;
  budgetUtilization: number | null;
  budgetUtilizationReason?: string;
  goals: FinancialGoalSummary[];
  status: CalculationStatus;
  complete: boolean;
  partial: boolean;
};

type AmountFrequency = "weekly" | "biweekly" | "semimonthly" | "monthly" | "annual";

function monthlyAmount(amount: number, frequency: string | undefined): number | null {
  if (!Number.isFinite(amount) || amount < 0 || !frequency || !isAmountFrequency(frequency)) return null;
  return toMonthlyIncome(amount, frequency);
}

function isAmountFrequency(value: string): value is AmountFrequency {
  return ["weekly", "biweekly", "semimonthly", "monthly", "annual"].includes(value);
}

function debtPayments(debts: readonly DebtProfile[] | undefined): MonthlyPlanningComponent {
  if (debts === undefined) return unavailableComponent();

  const excludedItems: PlanningExclusion[] = [];
  let total = 0;
  let included = 0;
  for (const debt of debts) {
    const amount = monthlyAmount(debt.minimumPayment ?? NaN, debt.paymentFrequency);
    if (amount === null) {
      excludedItems.push({
        name: debt.name,
        reason: debt.minimumPayment === undefined
          ? "minimum payment is unknown"
          : !debt.paymentFrequency
            ? "payment frequency is unknown"
            : "payment frequency is unsupported",
      });
      continue;
    }
    total += amount;
    included += 1;
  }
  return componentFromRows(debts.length, included, total, excludedItems);
}

function savingsAllocations(allocations: readonly SavingsAllocationProfile[] | undefined): MonthlyPlanningComponent {
  if (allocations === undefined) return unavailableComponent();

  const excludedItems: PlanningExclusion[] = [];
  let total = 0;
  let included = 0;
  for (const allocation of allocations) {
    const amount = monthlyAmount(allocation.amount ?? NaN, allocation.frequency);
    if (amount === null) {
      excludedItems.push({
        name: allocation.name,
        reason: allocation.amount === undefined
          ? "allocation amount is unknown"
          : !allocation.frequency
            ? "allocation frequency is unknown"
            : allocation.frequency === "per-paycheck"
              ? "per-paycheck allocations need an explicit monthly conversion"
              : "allocation frequency is unsupported",
      });
      continue;
    }
    total += amount;
    included += 1;
  }
  return componentFromRows(allocations.length, included, total, excludedItems);
}

function retirementContributions(
  plans: readonly RetirementContributionProfile[] | undefined,
  income: ReturnType<typeof estimateMonthlyBudgetIncome>,
): RetirementPlanningComponent {
  if (plans === undefined) return { ...unavailableComponent(), excludedFromRemainingCash: true };

  const excludedItems: PlanningExclusion[] = [];
  let total = 0;
  let included = 0;
  for (const plan of plans) {
    const contribution = plan.contribution;
    let amount: number | null = null;
    if (contribution.basis === "amount") {
      amount = monthlyAmount(contribution.amount ?? NaN, contribution.frequency);
    } else if (contribution.basis === "percentage" && contribution.percentageOf === "net-income") {
      const percentage = contribution.percentage;
      if (typeof percentage === "number" && Number.isFinite(percentage) && percentage >= 0 && percentage <= 100 &&
        income.estimatedMonthlyTakeHomeIncome != null) {
        amount = income.estimatedMonthlyTakeHomeIncome * percentage / 100;
      }
    }
    if (amount === null || !Number.isFinite(amount)) {
      excludedItems.push({
        name: plan.name,
        reason: contribution.basis === "percentage"
          ? contribution.percentageOf === "gross-income"
            ? "gross-income basis is unavailable from the take-home income model"
            : "retirement percentage is missing, invalid, or required income is unknown"
          : contribution.amount === undefined
            ? "contribution amount is unknown"
            : !contribution.frequency
              ? "contribution frequency is unknown"
              : "contribution frequency is unsupported",
      });
      continue;
    }
    total += amount;
    included += 1;
  }
  return {
    ...componentFromRows(plans.length, included, total, excludedItems),
    excludedFromRemainingCash: true,
  };
}

function componentFromRows(
  rowCount: number,
  includedCount: number,
  total: number,
  excludedItems: PlanningExclusion[],
): MonthlyPlanningComponent {
  const status: CalculationStatus = excludedItems.length === 0
    ? "complete"
    : includedCount > 0
      ? "partial"
      : "unavailable";
  const knownMonthlyAmount = rowCount === 0 || includedCount > 0 ? total : null;
  return {
    configured: true,
    monthlyAmount: knownMonthlyAmount,
    knownMonthlyAmount,
    amountMeaning: knownMonthlyAmount === null ? null : status === "partial" ? "known-subtotal" : "complete",
    status,
    complete: status === "complete",
    partial: status === "partial",
    excludedItems,
  };
}

function unavailableComponent(): MonthlyPlanningComponent {
  return {
    configured: false,
    monthlyAmount: null,
    knownMonthlyAmount: null,
    amountMeaning: null,
    status: "unavailable",
    complete: false,
    partial: false,
    excludedItems: [],
  };
}

function goalSummaries(goals: readonly FinancialGoalProfile[] | undefined): FinancialGoalSummary[] {
  return (goals ?? []).map((goal) => {
    const excludedItems: PlanningExclusion[] = [];
    if (goal.targetAmount !== undefined && !validNonNegative(goal.targetAmount)) {
      excludedItems.push({ name: goal.name, reason: "target amount is invalid" });
    }
    if (goal.targetDate !== undefined && !isValidTargetDate(goal.targetDate)) {
      excludedItems.push({ name: goal.name, reason: "target date is invalid" });
    }
    const validTarget = (goal.targetAmount === undefined || validNonNegative(goal.targetAmount)) &&
      (goal.targetDate === undefined || isValidTargetDate(goal.targetDate));
    return {
      name: goal.name,
      ...(goal.targetAmount !== undefined && validNonNegative(goal.targetAmount) ? { targetAmount: goal.targetAmount } : {}),
      ...(goal.targetDate !== undefined && isValidTargetDate(goal.targetDate) ? { targetDate: goal.targetDate } : {}),
      status: excludedItems.length === 0 ? validTarget ? "complete" : "unavailable" : validTarget ? "partial" : "unavailable",
      excludedItems,
      progress: null,
      progressReason: "no-explicit-funding-relationship" as const,
    };
  });
}

export function calculateFinancialPlanning(
  profile: FinancialProfile,
  options: { actualMonthlySpending?: number } = {},
): FinancialPlanningSummary {
  const income = estimateMonthlyBudgetIncome(profile);
  const recurringExpenses = estimateMonthlyRecurringExpenses(profile);
  const debtPaymentSummary = debtPayments(profile.debts);
  const savingsAllocationSummary = savingsAllocations(profile.savingsAllocations);
  const retirementContributionSummary = retirementContributions(profile.retirementContributionPlans, income);
  const monthlyIncome = income.estimatedMonthlyTakeHomeIncome;
  const monthlyExpenses = recurringExpenses.estimatedMonthlyExpenses;
  const monthlyDebtPayments = debtPaymentSummary.monthlyAmount;
  const monthlySavings = savingsAllocationSummary.monthlyAmount;
  const missingRemainingCashInputs = [
    monthlyIncome == null ? "monthly take-home income" : null,
    monthlyExpenses == null ? "monthly recurring expenses" : null,
    monthlyDebtPayments == null ? "monthly debt minimum payments" : null,
    monthlySavings == null ? "monthly savings allocations" : null,
  ].filter((value): value is string => value !== null);
  const remainingMonthlyCash = missingRemainingCashInputs.length === 0
    ? monthlyIncome! - monthlyExpenses! - monthlyDebtPayments! - monthlySavings!
    : null;
  const discretionarySpendingTarget = validNonNegative(profile.budget?.monthlySpendingTarget)
    ? profile.budget?.monthlySpendingTarget ?? null
    : null;
  const budgetUtilization = discretionarySpendingTarget != null &&
    validNonNegative(options.actualMonthlySpending) &&
    discretionarySpendingTarget > 0
    ? (options.actualMonthlySpending! / discretionarySpendingTarget) * 100
    : null;
  const componentStatuses: CalculationStatus[] = [
    income.status,
    recurringExpenses.configured
      ? recurringExpenses.complete ? "complete" : recurringExpenses.includedCount > 0 ? "partial" : "unavailable"
      : "unavailable",
    debtPaymentSummary.status,
    savingsAllocationSummary.status,
    retirementContributionSummary.status,
  ];
  const hasUsefulInformation = monthlyIncome !== null ||
    monthlyExpenses !== null ||
    debtPaymentSummary.knownMonthlyAmount !== null ||
    savingsAllocationSummary.knownMonthlyAmount !== null ||
    retirementContributionSummary.knownMonthlyAmount !== null ||
    componentStatuses.includes("partial");
  const status: CalculationStatus = componentStatuses.every((value) => value === "complete") && remainingMonthlyCash !== null
    ? "complete"
    : hasUsefulInformation
      ? "partial"
      : "unavailable";
  const goals = goalSummaries(profile.goals);

  return {
    income,
    recurringExpenses,
    debtPayments: debtPaymentSummary,
    savingsAllocations: savingsAllocationSummary,
    retirementContributions: retirementContributionSummary,
    remainingMonthlyCash,
    ...(missingRemainingCashInputs.length > 0
      ? { remainingMonthlyCashReason: `Unavailable until ${missingRemainingCashInputs.join(", ")} are known.` }
      : {}),
    discretionarySpendingTarget,
    ...(discretionarySpendingTarget == null
      ? { budgetUtilizationReason: "Unavailable until a valid discretionary spending target and actual spending are available." }
      : budgetUtilization == null
        ? { budgetUtilizationReason: discretionarySpendingTarget === 0 ? "Unavailable because the spending target is zero." : "Unavailable until actual spending is provided." }
        : {}),
    budgetUtilization,
    goals,
    status,
    complete: status === "complete",
    partial: status === "partial",
  };
}

function validNonNegative(value: number | undefined): boolean {
  return value !== undefined && Number.isFinite(value) && value >= 0;
}

function isValidTargetDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
