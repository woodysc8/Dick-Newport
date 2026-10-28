import type { FinancialPlan } from "./financialPlan";
import type { BudgetConfiguration } from "./budget";

/** A blank starter template; unknown personal values stay unset until customized. */
export type FinancialProfile = {
  label: string;
  currency: string;
  onboardingCompletedAt?: string;
  personal?: { fullName?: string; country?: string; householdSize?: number };
  income?: { amount?: number; basis?: "gross" | "take-home"; frequency?: "weekly" | "biweekly" | "semimonthly" | "monthly" | "other" };
  /** Manual estimates; they are not connected-account observations. */
  manualBalances?: { cash?: number; savings?: number; source: "user-entered" };
  debts?: readonly { name: string; balance?: number; monthlyPayment?: number }[];
  savingsTargets?: { emergencyFund?: number; minimumCashBuffer?: number };
  paychecks?: {
    netAmount?: number;
    frequency?: "weekly" | "biweekly" | "semimonthly" | "monthly" | "other";
    paydays?: readonly string[];
    rothContribution?: number;
    billsAllocation?: number;
    weeklySpendingAllocation?: number;
    cushion?: number;
  };
  roth?: FinancialPlan["roth"];
  bills?: Partial<FinancialPlan["bills"]>;
  weeklySpending?: Partial<FinancialPlan["weeklySpending"]>;
  recurringExpenses?: readonly { name: string; category?: string; amount?: number; frequency: "weekly" | "biweekly" | "monthly" | "annual" }[];
  retirementContributions?: { perPaycheck?: number; percentageOfIncome?: number; employerMatchPercentage?: number; destination?: string };
  budget?: BudgetConfiguration;
  budgetingPreferences?: { spendingPeriodStartDay?: string; includePendingTransactions?: boolean };
  savingsAllocations?: readonly { name: string; amount: number; frequency: "monthly" | "per-paycheck" }[];
  goals?: readonly { name: string; targetAmount?: number; targetDate?: string }[];
};

export const STARTER_FINANCIAL_PROFILE: FinancialProfile = {
  label: "Starter template (customize with your own values)",
  currency: "USD",
};

/** Existing dashboard example data. These are not universal defaults or observed transactions. */
export const LEGACY_EXAMPLE_FINANCIAL_PROFILE: FinancialProfile = {
  label: "Richard Newport legacy example (personal plan; replace before reuse)",
  currency: "USD",
  paychecks: {
    netAmount: 1900,
    frequency: "biweekly",
    paydays: ["2026-10-02", "2026-10-16", "2026-10-30", "2026-11-13", "2026-11-27", "2026-12-11", "2026-12-25"],
    rothContribution: 500,
    billsAllocation: 385,
    weeklySpendingAllocation: 840,
    cushion: 175,
  },
  roth: {
    destination: "Robinhood Roth IRA", totalRemaining: 3260,
    contributions: [
      { date: "2026-10-02", amount: 500 }, { date: "2026-10-16", amount: 500 },
      { date: "2026-10-30", amount: 500 }, { date: "2026-11-13", amount: 500 },
      { date: "2026-11-27", amount: 500 }, { date: "2026-12-11", amount: 500 },
      { date: "2026-12-25", amount: 260, mayExecuteOnNextTradingDay: true },
    ],
  },
  bills: {
    destination: "Robinhood HYSA", reservePurpose: "bills-cash-reserve", intendedApy: 0.0375,
    monthlyObligations: { rent: 733, utilities: 100, phone: 65, total: 898 },
    period: { start: "2026-10-01", end: "2026-12-31", totalRequired: 2694 }, perPaycheckAllocation: 385,
  },
  weeklySpending: {
    weeklyTarget: 420, dailyTarget: 60, periodStartDay: "Friday", periodEndDay: "Thursday",
    includes: ["subscriptions", "credit-card-purchases"],
    excludes: ["credit-card-payments", "transfers", "investment-activity"],
    venmoBalanceSemantics: "available-liquidity-offset",
  },
  budget: {
    monthlyIncome: 4240,
    expenses: [
      { name: "Housing & Bills", category: "housing_bills", amount: 985 },
      { name: "Food", category: "food", amount: 900 },
      { name: "Transportation", category: "transportation", amount: 260 },
      { name: "Fun & Entertainment", category: "fun_entertainment", amount: 0 },
      { name: "Shopping & Personal", category: "shopping_personal", amount: 200 },
      { name: "Health", category: "health", amount: 175 },
    ],
  },
};
