import { isIncomingVenmoDiningReimbursement } from "./accounting";
import { classifyTransaction, FinancialType } from "./classifyTransaction";
import { getSpendingPeriod, getWeeklySpendingTarget, DateInput } from "./financialPlan";
import { FinancialProfile, STARTER_FINANCIAL_PROFILE } from "./financialProfileDefaults";

export type WeeklySpendingTransaction = {
  date: string;
  amount: number | string | null;
  name?: string | null;
  merchant_name?: string | null;
  category?: string | string[] | null;
  pending?: boolean | null;
};

export type WeeklySpendingResult = {
  periodStart: string;
  periodEnd: string;
  target: number | null;
  dailyTarget: number | null;
  eligibleSpending: number;
  remainingBudget: number | null;
  venmoBalance: number;
  remainingFundingNeed: number | null;
  spendingPercentage: number | null;
  transactionCount: number;
};

export type WeeklySpendingOptions = {
  asOf: DateInput;
  transactions: readonly WeeklySpendingTransaction[];
  venmoBalance: number;
  profile?: FinancialProfile;
};

function amountOf(transaction: WeeklySpendingTransaction): number {
  const amount = Number(transaction.amount ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function amountForEligibleSpending(
  transaction: WeeklySpendingTransaction,
  financialType: FinancialType,
  includesSpending: boolean
): number {
  const amount = amountOf(transaction);

  if (financialType === "refund") {
    return amount === 0 ? 0 : -Math.abs(amount);
  }

  return includesSpending && amount > 0 ? amount : 0;
}

export function calculateWeeklySpending({ asOf, transactions, venmoBalance, profile = STARTER_FINANCIAL_PROFILE }: WeeklySpendingOptions): WeeklySpendingResult {
  const period = getSpendingPeriod(asOf);
  let eligibleSpending = 0;
  let transactionCount = 0;

  for (const transaction of transactions) {
    if (transaction.date < period.start || transaction.date > period.end) {
      continue;
    }

    if (isIncomingVenmoDiningReimbursement(transaction)) {
      eligibleSpending -= Math.abs(amountOf(transaction));
      transactionCount += 1;
      continue;
    }

    const classification = classifyTransaction(transaction);
    const amount = amountForEligibleSpending(
      transaction,
      classification.financial_type,
      classification.include_in_spending
    );

    if (amount !== 0) {
      eligibleSpending += amount;
      transactionCount += 1;
    }
  }

  eligibleSpending = Math.max(0, eligibleSpending);
  const target = getWeeklySpendingTarget(profile) ?? null;
  const remainingBudget = target == null ? null : Math.max(0, target - eligibleSpending);
  const availableVenmo = Math.max(0, Number.isFinite(venmoBalance) ? venmoBalance : 0);
  const remainingFundingNeed = remainingBudget == null ? null : Math.max(0, remainingBudget - availableVenmo);

  return {
    periodStart: period.start,
    periodEnd: period.end,
    target,
    dailyTarget: profile.weeklySpending?.dailyTarget ?? (target == null ? null : target / 7),
    eligibleSpending,
    remainingBudget,
    venmoBalance: availableVenmo,
    remainingFundingNeed,
    spendingPercentage: target == null ? null : target > 0 ? (eligibleSpending / target) * 100 : 0,
    transactionCount,
  };
}
