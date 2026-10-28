/*
 * ============================================================
 * BUDGET CONFIGURATION
 * ============================================================
 *
 * Simple, Plaid-friendly personal budget.
 *
 * The dashboard intentionally uses broad categories rather
 * than trying to force Plaid transactions into very specific
 * categories like:
 *
 *   Mortgage
 *   Electricity
 *   Gym
 *   Doctors
 *   Medicine
 *   Cable
 *   etc.
 *
 * Plaid is much more reliable at identifying broad spending
 * types, so the budget follows that same philosophy.
 * ============================================================
 */

export interface BudgetLine {
  name: string;
  category: string;
  amount: number;
  isIncome: boolean;
  isSavings: boolean;
}

export interface MonthlyBudget {
  year: number;
  month: number;
  lines: BudgetLine[];
  incomeConfigured: boolean;
  expensesConfigured: boolean;
  savingsConfigured: boolean;
}

export interface BudgetConfiguration {
  monthlyIncome?: number;
  monthlySpendingTarget?: number;
  expenses?: readonly { name: string; category: string; amount: number }[];
}

/*
 * ============================================================
 * GET MONTHLY BUDGET
 * ============================================================
 */

export function getMonthlyBudget(
  year: number,
  month: number,
  configuration: BudgetConfiguration = {},
): MonthlyBudget {
  const income = configuration.monthlyIncome;
  const expenses = configuration.expenses ?? [];
  const incomeConfigured = income !== undefined;
  const expensesConfigured = configuration.expenses !== undefined;
  const savingsConfigured = incomeConfigured && expensesConfigured;
  const savings = savingsConfigured ? income - expenses.reduce((total, line) => total + line.amount, 0) : undefined;
  return {
    year,
    month,
    incomeConfigured,
    expensesConfigured,
    savingsConfigured,
    lines: [
      /*
       * --------------------------------------------------------
       * INCOME
       * --------------------------------------------------------
       */

      ...(incomeConfigured ? [{
        name: "Monthly Income",
        category: "income",
        amount: income!,
        isIncome: true,
        isSavings: false,
      }] : []),

      /*
       * --------------------------------------------------------
       * EXPENSES
       * --------------------------------------------------------
       */

      ...(expensesConfigured ? expenses.map((line) => ({
        name: line.name,
        category: line.category,
        amount: line.amount,
        isIncome: false,
        isSavings: false,
      })) : []),

      /*
       * --------------------------------------------------------
       * SAVINGS
       * --------------------------------------------------------
       */

      ...(savingsConfigured ? [{
        name: "Savings",
        category: "savings",
        amount: savings!,
        isIncome: false,
        isSavings: true,
      }] : []),
    ],
  };
}

/*
 * ============================================================
 * BUDGETED INCOME
 * ============================================================
 */

export function getBudgetedIncome(
  budget: MonthlyBudget
): number | null {
  if (!budget.incomeConfigured) return null;
  return budget.lines
    .filter((line) => line.isIncome)
    .reduce(
      (total, line) => total + line.amount,
      0
    );
}

/*
 * ============================================================
 * BUDGETED EXPENSES
 * ============================================================
 */

export function getBudgetedExpenses(
  budget: MonthlyBudget
): number | null {
  if (!budget.expensesConfigured) return null;
  return budget.lines
    .filter(
      (line) =>
        !line.isIncome &&
        !line.isSavings
    )
    .reduce(
      (total, line) => total + line.amount,
      0
    );
}

/*
 * ============================================================
 * BUDGETED SAVINGS
 * ============================================================
 */

export function getBudgetedSavings(
  budget: MonthlyBudget
): number | null {
  if (!budget.savingsConfigured) return null;
  return budget.lines
    .filter((line) => line.isSavings)
    .reduce(
      (total, line) => total + line.amount,
      0
    );
}

/*
 * ============================================================
 * DEFAULT EXPORT
 * ============================================================
 */

const budget = {
  getMonthlyBudget,
  getBudgetedIncome,
  getBudgetedExpenses,
  getBudgetedSavings,
};

export default budget;
