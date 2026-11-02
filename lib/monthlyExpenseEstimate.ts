import type { FinancialProfile, RecurringExpenseProfile } from "./financialProfileDefaults";
import { toMonthlyIncome } from "./monthlyIncomeEstimate";

export type ExpenseExclusionReason = "unknown-amount" | "invalid-amount" | "unknown-frequency" | "irregular-expense" | "unsupported-frequency";

export type MonthlyExpenseEstimateItem = {
  name: string;
  category?: string;
  amount?: number;
  frequency?: RecurringExpenseProfile["frequency"];
  included: boolean;
  estimatedMonthlyAmount: number | null;
  exclusionReason?: ExpenseExclusionReason;
};

export type MonthlyExpenseEstimate = {
  configured: boolean;
  estimatedMonthlyExpenses: number | null;
  items: MonthlyExpenseEstimateItem[];
  includedCount: number;
  recordCount: number;
  includedProportion: number | null;
  excludedItems: MonthlyExpenseEstimateItem[];
  complete: boolean;
  partial: boolean;
};

/** Uses the income adapter's shared calendar-year monthly conversion assumptions. */
export function estimateMonthlyRecurringExpenses(profile: FinancialProfile): MonthlyExpenseEstimate {
  const expenses = profile.recurringExpenses;
  if (expenses === undefined) {
    return {
      configured: false,
      estimatedMonthlyExpenses: null,
      items: [],
      includedCount: 0,
      recordCount: 0,
      includedProportion: null,
      excludedItems: [],
      complete: false,
      partial: false,
    };
  }

  const items = expenses.map(toEstimateItem);
  const includedItems = items.filter((item) => item.included);
  const excludedItems = items.filter((item) => !item.included);
  const knownTotal = includedItems.reduce((sum, item) => sum + (item.estimatedMonthlyAmount ?? 0), 0);
  // An explicitly empty list means a configured zero. If every non-empty row is
  // unknown or unusable, retain an unavailable total instead of implying zero.
  const estimatedMonthlyExpenses = expenses.length === 0 || includedItems.length > 0 ? knownTotal : null;

  return {
    configured: true,
    estimatedMonthlyExpenses,
    items,
    includedCount: includedItems.length,
    recordCount: items.length,
    includedProportion: items.length === 0 ? null : includedItems.length / items.length,
    excludedItems,
    complete: excludedItems.length === 0,
    partial: excludedItems.length > 0,
  };
}

function toEstimateItem(expense: RecurringExpenseProfile): MonthlyExpenseEstimateItem {
  let exclusionReason: ExpenseExclusionReason | undefined;
  if (expense.amount === undefined) exclusionReason = "unknown-amount";
  else if (!Number.isFinite(expense.amount) || expense.amount < 0) exclusionReason = "invalid-amount";
  else if (!expense.frequency) exclusionReason = "unknown-frequency";
  else if (expense.frequency === "irregular") exclusionReason = "irregular-expense";
  else if (toMonthlyIncome(expense.amount, expense.frequency) === null) exclusionReason = "unsupported-frequency";

  return {
    name: expense.name,
    ...(expense.category !== undefined ? { category: expense.category } : {}),
    amount: expense.amount,
    frequency: expense.frequency,
    included: exclusionReason === undefined,
    estimatedMonthlyAmount: exclusionReason ? null : toMonthlyIncome(expense.amount!, expense.frequency!)!,
    ...(exclusionReason ? { exclusionReason } : {}),
  };
}
