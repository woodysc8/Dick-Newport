import { isIncomingVenmoDiningReimbursement } from "./accounting";
import { classifyTransaction, FinancialType } from "./classifyTransaction";
import { getSpendingPeriod, getWeeklySpendingTarget, DateInput } from "./financialPlan";
import { FinancialProfile, STARTER_FINANCIAL_PROFILE } from "./financialProfileDefaults";

export type WeeklySpendingAccount = {
  id: string;
  plaid_account_id?: string | null;
  currency?: string | null;
};

export type WeeklySpendingTransaction = {
  date: string;
  amount: number | string | null;
  name?: string | null;
  merchant_name?: string | null;
  category?: string | string[] | null;
  pending?: boolean | null;
  account_id?: string | null;
};

export type WeeklySpendingResult = {
  periodStart: string;
  periodEnd: string;
  target: number | null;
  dailyTarget: number | null;
  eligibleSpending: number | null;
  remainingBudget: number | null;
  venmoBalance: number | null;
  remainingFundingNeed: number | null;
  spendingPercentage: number | null;
  transactionCount: number;
  currency: string | null;
  currencySafe: boolean;
};

export type WeeklySpendingOptions = {
  asOf: DateInput;
  transactions: readonly WeeklySpendingTransaction[];
  accounts?: readonly WeeklySpendingAccount[];
  venmoBalance: number | null;
  venmoCurrency?: string | null;
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

export function calculateWeeklySpending({ asOf, transactions, accounts = [], venmoBalance, venmoCurrency, profile = STARTER_FINANCIAL_PROFILE }: WeeklySpendingOptions): WeeklySpendingResult {
  const period = getSpendingPeriod(asOf);
  let eligibleSpending = 0;
  let transactionCount = 0;
  const accountCurrencies = new Map<string, string | null>();
  for (const account of accounts) {
    const currency = typeof account.currency === "string" && /^[A-Za-z]{3}$/.test(account.currency)
      ? account.currency.toUpperCase()
      : null;
    accountCurrencies.set(account.id, currency);
    if (account.plaid_account_id) accountCurrencies.set(account.plaid_account_id, currency);
  }
  const currencies = new Set<string>();
  let unknownCurrency = false;

  for (const transaction of transactions) {
    if (transaction.date < period.start || transaction.date > period.end) {
      continue;
    }
    if (transaction.pending && profile.budgetingPreferences?.includePendingTransactions === false) {
      continue;
    }

    if (isIncomingVenmoDiningReimbursement(transaction)) {
      const currency = transaction.account_id ? accountCurrencies.get(transaction.account_id) : null;
      if (currency == null) unknownCurrency = true;
      else currencies.add(currency);
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
      const currency = transaction.account_id ? accountCurrencies.get(transaction.account_id) : null;
      if (currency == null) unknownCurrency = true;
      else currencies.add(currency);
      eligibleSpending += amount;
      transactionCount += 1;
    }
  }

  const currency = currencies.size === 1 && !unknownCurrency ? [...currencies][0] : null;
  const currencySafe = !unknownCurrency && currencies.size <= 1;
  const safeEligibleSpending = currencySafe ? Math.max(0, eligibleSpending) : null;
  const target = getWeeklySpendingTarget(profile) ?? null;
  const remainingBudget = target == null || safeEligibleSpending == null ? null : Math.max(0, target - safeEligibleSpending);
  const availableVenmo = venmoBalance == null || !Number.isFinite(venmoBalance) ? null : Math.max(0, venmoBalance);
  const fundingCurrencySafe = availableVenmo == null || availableVenmo === 0 || (venmoCurrency != null && currency != null && venmoCurrency.toUpperCase() === currency);
  const remainingFundingNeed = remainingBudget == null || !fundingCurrencySafe || availableVenmo == null
    ? null
    : Math.max(0, remainingBudget - availableVenmo);

  return {
    periodStart: period.start,
    periodEnd: period.end,
    target,
    dailyTarget: profile.weeklySpending?.dailyTarget ?? (target == null ? null : target / 7),
    eligibleSpending: safeEligibleSpending,
    remainingBudget,
    venmoBalance: availableVenmo,
    remainingFundingNeed,
    spendingPercentage: target == null || safeEligibleSpending == null ? null : target > 0 ? (safeEligibleSpending / target) * 100 : 0,
    transactionCount,
    currency,
    currencySafe: currencySafe && fundingCurrencySafe,
  };
}
