import accounting, { DashboardBudgetCategoryTotal, MonthlyAccounting } from "./accounting";
import { FinancialAccountPurpose, getAccountPurpose } from "./accountPurpose";
import {
  DashboardAccount,
  DashboardAccountClass,
  InvestmentHolding,
  InvestmentSnapshot,
  RecentTransaction,
  getDashboardAccountClass,
} from "./dashboard";
import {
  BillsPlan,
  getCurrentOrNextPlannedPaycheck,
  getPaycheckAllocation,
} from "./financialPlan";
import { STARTER_FINANCIAL_PROFILE } from "./financialProfileDefaults";
import type { FinancialProfile } from "./financialProfileDefaults";
import { calculateWeeklySpending, WeeklySpendingResult } from "./weeklySpending";
import { isCashEquivalentAsset } from "./investmentSnapshots";

export type AccountWithClass = DashboardAccount & { accountClass: DashboardAccountClass };

export type PortfolioHolding = InvestmentHolding & {
  gain: number | null;
  gainPercent: number | null;
  allocationPercent: number | null;
};

export type PortfolioPosition = {
  accounts: AccountWithClass[];
  currentValue: number;
  investedValue: number;
  cashValue: number;
  holdings: PortfolioHolding[];
  totalGain: number | null;
  totalGainPercent: number | null;
};

export type PortfolioGrowthObservation = {
  date: string;
  value: number;
};

export type PortfolioGrowthSeries = {
  observations: PortfolioGrowthObservation[];
  earliestValue: number | null;
  latestValue: number | null;
  changeSinceFirstSnapshot: number | null;
};

export type DashboardViewModel = {
  accountSummary: ReturnType<typeof accounting.summarizeAccounts>;
  monthly: MonthlyAccounting;
  budgetLines: DashboardBudgetCategoryTotal[];
  accounts: AccountWithClass[];
  cashAccounts: AccountWithClass[];
  creditAccounts: AccountWithClass[];
  taxableInvestmentAccounts: AccountWithClass[];
  retirementAccounts: AccountWithClass[];
  retirementAssets: number | null;
  netCashFlow: number | null;
  savingsRate: number | null;
  spendingBudgetUsage: number | null;
  projectedMonthEndSpending: number | null;
  monthlyHistory: Array<{ label: string; income: number; spending: number }>;
  investmentPerformance: {
    totalReturn: number | null;
    totalReturnPercent: number | null;
    sevenDayReturn: number | null;
    sevenDayReturnPercent: number | null;
    ytdReturn: number | null;
    ytdReturnPercent: number | null;
  };
  portfolioGrowth: PortfolioGrowthSeries;
  overallPosition: {
    netWorth: number | null;
    checkingAccounts: AccountWithClass[];
    checkingBalance: number;
  };
  financialPosition: {
    equities: PortfolioPosition;
    retirement: PortfolioPosition;
    hysa: {
      accounts: AccountWithClass[];
      currentBalance: number;
      configuredApy: number | null;
    };
  };
  weeklySpending: WeeklySpendingResult;
  financialPlan: {
    paycheck: ReturnType<typeof getPaycheckAllocation>;
    nextPaycheck: ReturnType<typeof getCurrentOrNextPlannedPaycheck>;
    rothRemaining: number;
    rothContributions: NonNullable<FinancialProfile["roth"]>["contributions"];
    bills: BillsPlan;
  };
};

function numberOrNull(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
}

function monthlyHistory(transactions: RecentTransaction[], accounts: DashboardAccount[], now: Date) {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = monthKey(date);
    const monthly = accounting.computeMonthlyAccounting(
      transactions.filter((transaction) => transaction.date.startsWith(key)),
      accounts
    );

    return { label: monthLabel(date), income: monthly.income, spending: monthly.spending };
  });
}

function getInvestmentPerformance(holdings: InvestmentHolding[], snapshots: InvestmentSnapshot[], now: Date) {
  const reliableHoldings = holdings.length > 0 && holdings.every((holding) =>
    numberOrNull(holding.institution_value) != null && (numberOrNull(holding.cost_basis) ?? 0) > 0
  );
  const holdingsValue = reliableHoldings
    ? holdings.reduce((total, holding) => total + (numberOrNull(holding.institution_value) ?? 0), 0)
    : null;
  const costBasis = reliableHoldings
    ? holdings.reduce((total, holding) => total + (numberOrNull(holding.cost_basis) ?? 0), 0)
    : null;
  const totalReturn = holdingsValue != null && costBasis != null ? holdingsValue - costBasis : null;
  const totalReturnPercent = totalReturn != null && costBasis != null && costBasis > 0
    ? (totalReturn / costBasis) * 100
    : null;
  const target = new Date(now);
  target.setDate(target.getDate() - 7);
  const targetMs = target.getTime();
  const weeklySnapshot = snapshots
    .filter((snapshot) => new Date(snapshot.snapshot_date).getTime() < now.getTime())
    .map((snapshot) => ({ snapshot, distance: Math.abs(new Date(snapshot.snapshot_date).getTime() - targetMs) }))
    .filter((candidate) => candidate.distance <= 2 * 24 * 60 * 60 * 1000)
    .sort((left, right) => left.distance - right.distance)[0]?.snapshot;
  const weeklyValue = numberOrNull(weeklySnapshot?.portfolio_value);
  const sevenDayReturn = holdingsValue != null && weeklyValue != null && weeklyValue > 0
    ? holdingsValue - weeklyValue
    : null;
  const sevenDayReturnPercent = sevenDayReturn != null && weeklyValue != null
    ? (sevenDayReturn / weeklyValue) * 100
    : null;

  return {
    totalReturn,
    totalReturnPercent,
    sevenDayReturn,
    sevenDayReturnPercent,
    // A YTD benchmark requires a compatible beginning-of-year portfolio snapshot.
    ytdReturn: null,
    ytdReturnPercent: null,
  };
}

function numericBalance(value: number | string | null): number {
  return numberOrNull(value) ?? 0;
}

function sumBalances(accounts: DashboardAccount[]): number {
  return accounts.reduce((total, account) => total + numericBalance(account.current_balance), 0);
}

function getPurpose(account: DashboardAccount): FinancialAccountPurpose {
  return getAccountPurpose(account);
}

export function isCashHolding(holding: InvestmentHolding): boolean {
  return isCashEquivalentAsset({
    tickerSymbol: holding.ticker_symbol,
    securityName: holding.security_name,
    currency: holding.currency ?? holding.iso_currency_code,
    value: holding.institution_value,
  });
}

export function buildPortfolioGrowthSeries(
  snapshots: InvestmentSnapshot[],
  accounts: DashboardAccount[]
): PortfolioGrowthSeries {
  const eligibleAccountIds = new Set(
    accounts
      .filter((account) => {
        const purpose = getPurpose(account);
        return purpose === "equities" || purpose === "retirement";
      })
      .map((account) => account.plaid_account_id)
      .filter((id): id is string => Boolean(id))
  );
  const valuesByDate = new Map<string, Map<string, number>>();

  for (const snapshot of snapshots) {
    if (!eligibleAccountIds.has(snapshot.plaid_account_id)) continue;
    const value = numberOrNull(snapshot.securities_value);
    if (value == null) continue;
    const accountValues = valuesByDate.get(snapshot.snapshot_date) ?? new Map<string, number>();
    accountValues.set(snapshot.plaid_account_id, (accountValues.get(snapshot.plaid_account_id) ?? 0) + value);
    valuesByDate.set(snapshot.snapshot_date, accountValues);
  }

  const observations = Array.from(valuesByDate.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, accountValues]) => ({
      date,
      value: Array.from(accountValues.values()).reduce((total, value) => total + value, 0),
    }));
  const earliestValue = observations[0]?.value ?? null;
  const latestValue = observations.at(-1)?.value ?? null;

  return {
    observations,
    earliestValue,
    latestValue,
    changeSinceFirstSnapshot: earliestValue != null && latestValue != null ? latestValue - earliestValue : null,
  };
}

function buildPortfolioPosition(
  accounts: AccountWithClass[],
  holdings: InvestmentHolding[],
  purpose: "equities" | "retirement"
): PortfolioPosition {
  const purposeAccounts = accounts.filter((account) => getPurpose(account) === purpose);
  const purposePlaidIds = new Set(
    purposeAccounts.map((account) => account.plaid_account_id).filter((id): id is string => Boolean(id))
  );
  const purposeHoldings = holdings.filter((holding) => holding.plaid_account_id != null && purposePlaidIds.has(holding.plaid_account_id) && !isCashHolding(holding));
  const currentValue = sumBalances(purposeAccounts);
  const investedValue = purposeHoldings.reduce((total, holding) => total + numericBalance(holding.institution_value), 0);
  const holdingsWithMetrics = purposeHoldings.map((holding) => {
    const value = numberOrNull(holding.institution_value);
    const costBasis = numberOrNull(holding.cost_basis);
    const gain = value != null && costBasis != null ? value - costBasis : null;
    return {
      ...holding,
      gain,
      gainPercent: gain != null && costBasis != null && costBasis > 0 ? (gain / costBasis) * 100 : null,
      allocationPercent: investedValue > 0 && value != null ? (value / investedValue) * 100 : null,
    };
  });
  const knownGains = holdingsWithMetrics.filter((holding) => holding.gain != null);
  const totalGain = knownGains.length > 0 ? knownGains.reduce((total, holding) => total + (holding.gain ?? 0), 0) : null;
  const totalCostBasis = purposeHoldings.reduce((total, holding) => total + (numberOrNull(holding.cost_basis) ?? 0), 0);

  return {
    accounts: purposeAccounts,
    currentValue,
    investedValue,
    cashValue: Math.max(0, currentValue - investedValue),
    holdings: holdingsWithMetrics,
    totalGain,
    totalGainPercent: totalGain != null && totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : null,
  };
}

export function buildDashboardViewModel({
  accounts,
  monthTransactions,
  historicalTransactions,
  holdings,
  snapshots,
  weeklyTransactions = [],
  now = new Date(),
  profile: suppliedProfile = STARTER_FINANCIAL_PROFILE,
}: {
  accounts: DashboardAccount[];
  monthTransactions: RecentTransaction[];
  historicalTransactions: RecentTransaction[];
  holdings: InvestmentHolding[];
  snapshots: InvestmentSnapshot[];
  weeklyTransactions?: RecentTransaction[];
  now?: Date;
  profile?: FinancialProfile;
}): DashboardViewModel {
  const profile = suppliedProfile;
  const accountsWithClass = accounts.map((account) => ({ ...account, accountClass: getDashboardAccountClass(account) }));
  const accountSummary = accounting.summarizeAccounts(accounts);
  const monthly = accounting.computeMonthlyAccounting(monthTransactions, accounts);
  const cashAccounts = accountsWithClass.filter((account) => account.accountClass === "cash");
  const creditAccounts = accountsWithClass.filter((account) => account.accountClass === "credit");
  const retirementAccounts = accountsWithClass.filter((account) => account.accountClass === "retirement");
  const taxableInvestmentAccounts = accountsWithClass.filter((account) => account.accountClass === "investment");
  const retirementAssets = accounting.summarizeAccounts(retirementAccounts).investments;
  const netCashFlow = monthly.income > 0 ? monthly.income - monthly.spending : null;
  const savingsRate = netCashFlow != null && monthly.income > 0 ? (netCashFlow / monthly.income) * 100 : null;
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedMonthEndSpending = dayOfMonth >= 2 ? (monthly.spending / dayOfMonth) * daysInMonth : null;
  const hysaAccounts = accountsWithClass.filter((account) => getPurpose(account) === "hysa");
  const checkingAccounts = accountsWithClass.filter((account) => getPurpose(account) === "spending");
  const venmoBalance = accountsWithClass
    .filter((account) => getPurpose(account) === "venmo")
    .reduce((total, account) => total + numericBalance(account.current_balance), 0);
  const equitiesPosition = buildPortfolioPosition(accountsWithClass, holdings, "equities");
  const retirementPosition = buildPortfolioPosition(accountsWithClass, holdings, "retirement");
  const configuredSpendingTarget = profile.budget?.monthlySpendingTarget ??
    (profile.budget?.expenses?.length ? profile.budget.expenses.reduce((total, line) => total + line.amount, 0) : undefined);

  return {
    accountSummary,
    monthly,
    budgetLines: accounting.getDashboardBudgetTotals(monthly.spendingByCategory),
    accounts: accountsWithClass,
    cashAccounts,
    creditAccounts,
    taxableInvestmentAccounts,
    retirementAccounts,
    retirementAssets,
    netCashFlow,
    savingsRate,
    spendingBudgetUsage: configuredSpendingTarget == null ? null : accounting.getBudgetUsagePercent(configuredSpendingTarget, monthly.spending),
    projectedMonthEndSpending,
    monthlyHistory: monthlyHistory(historicalTransactions, accounts, now),
    investmentPerformance: getInvestmentPerformance(holdings, snapshots, now),
    portfolioGrowth: buildPortfolioGrowthSeries(snapshots, accounts),
    overallPosition: {
      netWorth: accountSummary.netWorth,
      checkingAccounts,
      checkingBalance: sumBalances(checkingAccounts),
    },
    financialPosition: {
      equities: equitiesPosition,
      retirement: retirementPosition,
      hysa: {
        accounts: hysaAccounts,
        currentBalance: sumBalances(hysaAccounts) + equitiesPosition.cashValue,
        configuredApy: profile.bills?.intendedApy ?? null,
      },
    },
    weeklySpending: calculateWeeklySpending({
      asOf: now,
      transactions: weeklyTransactions,
      venmoBalance,
      profile,
    }),
    financialPlan: {
      paycheck: getPaycheckAllocation(profile),
      nextPaycheck: getCurrentOrNextPlannedPaycheck(now, profile),
      rothRemaining: profile.roth?.totalRemaining ?? 0,
      rothContributions: profile.roth?.contributions ?? [],
      bills: {
        reservePurpose: "bills-cash-reserve",
        ...profile.bills,
        monthlyObligations: { ...profile.bills?.monthlyObligations },
      },
    },
  };
}
