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
import { calculateFinancialPlanning, FinancialPlanningSummary } from "./financialPlanning";
import { STARTER_FINANCIAL_PROFILE } from "./financialProfileDefaults";
import type { DebtProfile, FinancialProfile, FinancialGoalProfile, PropertyProfile, RetirementContributionProfile } from "./financialProfileDefaults";
import { calculateWeeklySpending, WeeklySpendingResult } from "./weeklySpending";
import { isCashEquivalentAsset } from "./investmentSnapshots";
import { estimateMonthlyBudgetIncome, MonthlyIncomeEstimate } from "./monthlyIncomeEstimate";
import { estimateMonthlyRecurringExpenses, MonthlyExpenseEstimate } from "./monthlyExpenseEstimate";
import { ProfileAccountBalanceSummary, summarizeProfileAccountBalances } from "./profileAccountBalances";
import { normalizeFinancialProfile } from "./financialProfileNormalization";

export type AccountWithClass = DashboardAccount & { accountClass: DashboardAccountClass };

export type PortfolioHolding = InvestmentHolding & {
  gain: number | null;
  gainPercent: number | null;
  allocationPercent: number | null;
};

export type PortfolioPosition = {
  accounts: AccountWithClass[];
  currentValue: number | null;
  investedValue: number | null;
  cashValue: number | null;
  currency: string | null;
  currencies: string[];
  mixedCurrency: boolean;
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
  currency: string | null;
  mixedCurrency: boolean;
};

export type DashboardProperty = PropertyProfile & {
  ownershipAdjustedValue: number | null;
};

export type DashboardViewModel = {
  accountSummary: ReturnType<typeof accounting.summarizeAccounts>;
  connectedAccountSummary: ReturnType<typeof accounting.summarizeAccounts>;
  profileAccountBalances: ProfileAccountBalanceSummary;
  monthly: MonthlyAccounting;
  monthlyIncomeEstimate: MonthlyIncomeEstimate;
  monthlyExpenseEstimate: MonthlyExpenseEstimate;
  financialPlanning: FinancialPlanningSummary;
  properties: DashboardProperty[];
  debts: readonly DebtProfile[];
  retirementContributionPlans: readonly RetirementContributionProfile[];
  goals: readonly FinancialGoalProfile[];
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
  monthlyHistory: Array<{ label: string; income: number; spending: number; currencySafe: boolean }>;
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
    connectedNetWorth: number | null;
    profileAccountNetWorth: number | null;
    netWorthComplete: boolean;
    checkingAccounts: AccountWithClass[];
    checkingBalance: number;
  };
  financialPosition: {
    equities: PortfolioPosition;
    retirement: PortfolioPosition;
    hysa: {
      accounts: AccountWithClass[];
      currentBalance: number | null;
      currency: string | null;
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
    estimatedRecurringCashFlow: number | null;
    recurringCashFlowComplete: boolean;
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

function monthlyHistory(transactions: RecentTransaction[], accounts: DashboardAccount[], now: Date, includePending?: boolean) {
  return Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = monthKey(date);
    const monthly = accounting.computeMonthlyAccounting(
      transactions.filter((transaction) => transaction.date.startsWith(key)),
      accounts,
      { includePending }
    );

    return { label: monthLabel(date), income: monthly.currencySafe ? monthly.income : 0, spending: monthly.currencySafe ? monthly.spending : 0, currencySafe: monthly.currencySafe };
  });
}

function getInvestmentPerformance(holdings: InvestmentHolding[], snapshots: InvestmentSnapshot[], accounts: DashboardAccount[], now: Date) {
  const accountCurrencyByPlaidId = new Map(accounts.map((account) => [account.plaid_account_id, normalizedCurrency(account.currency)]));
  const currencies = new Set<string>();
  let unknownCurrency = false;
  for (const holding of holdings) {
    const currency = normalizedCurrency(holding.currency ?? holding.iso_currency_code) ?? accountCurrencyByPlaidId.get(holding.plaid_account_id);
    if (currency) currencies.add(currency);
    else unknownCurrency = true;
  }
  for (const snapshot of snapshots) {
    const currency = accountCurrencyByPlaidId.get(snapshot.plaid_account_id);
    if (currency) currencies.add(currency);
    else unknownCurrency = true;
  }
  const mixedCurrency = currencies.size > 1 || unknownCurrency;
  const unavailable = mixedCurrency || (currencies.size === 0 && unknownCurrency);
  const reliableHoldings = holdings.length > 0 && holdings.every((holding) =>
    numberOrNull(holding.institution_value) != null && (numberOrNull(holding.cost_basis) ?? 0) > 0
  );
  const holdingsValue = unavailable ? null : reliableHoldings
    ? holdings.reduce((total, holding) => total + (numberOrNull(holding.institution_value) ?? 0), 0)
    : null;
  const costBasis = unavailable ? null : reliableHoldings
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

function addKnownTotals(left: number | null, right: number | null): number | null {
  return left == null || right == null ? null : left + right;
}

function normalizedCurrency(value: unknown): string | null {
  const currency = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function combineAccountSummaries(
  connected: ReturnType<typeof accounting.summarizeAccounts>,
  profile: ProfileAccountBalanceSummary
): ReturnType<typeof accounting.summarizeAccounts> {
  if (!profile.configured) return connected;
  if (!connected.configured) {
    return {
      configured: true,
      cash: profile.cash,
      investments: profile.investments,
      crypto: null,
      credit: profile.liabilities,
      netWorth: profile.netWorth,
      currency: profile.currency,
      currencies: profile.currencies,
      mixedCurrency: profile.mixedCurrency,
      currencyTotals: {},
    };
  }
  const currencies = new Set([...connected.currencies, ...profile.currencies]);
  const compatible = !connected.mixedCurrency && !profile.mixedCurrency &&
    connected.currency != null && profile.currency != null && connected.currency === profile.currency;
  if (!compatible) {
    return {
      configured: true,
      cash: null,
      investments: null,
      crypto: null,
      credit: null,
      netWorth: null,
      currency: null,
      currencies: [...currencies].sort(),
      mixedCurrency: true,
      currencyTotals: {},
    };
  }
  return {
    configured: true,
    cash: addKnownTotals(connected.cash, profile.cash),
    investments: addKnownTotals(connected.investments, profile.investments),
    crypto: connected.crypto,
    credit: addKnownTotals(connected.credit, profile.liabilities),
    netWorth: connected.netWorth == null || profile.netWorth == null ? null : connected.netWorth + profile.netWorth,
    currency: connected.currency ?? profile.currency,
    currencies: [...currencies].sort(),
    mixedCurrency: false,
    currencyTotals: connected.currencyTotals,
  };
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
  const currencies = new Set<string>();
  let unknownCurrency = false;

  for (const snapshot of snapshots) {
    if (!eligibleAccountIds.has(snapshot.plaid_account_id)) continue;
    const accountCurrency = normalizedCurrency(accounts.find((account) => account.plaid_account_id === snapshot.plaid_account_id)?.currency);
    if (accountCurrency) currencies.add(accountCurrency);
    else unknownCurrency = true;
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
  const mixedCurrency = currencies.size > 1 || unknownCurrency;

  return {
    observations: mixedCurrency ? [] : observations,
    earliestValue: mixedCurrency ? null : earliestValue,
    latestValue: mixedCurrency ? null : latestValue,
    changeSinceFirstSnapshot: mixedCurrency ? null : earliestValue != null && latestValue != null ? latestValue - earliestValue : null,
    currency: currencies.size === 1 && !unknownCurrency ? [...currencies][0] : null,
    mixedCurrency,
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
  const accountCurrencyByPlaidId = new Map(purposeAccounts.map((account) => [account.plaid_account_id, normalizedCurrency(account.currency)]));
  const currencies = new Set<string>();
  let unknownCurrency = false;
  for (const account of purposeAccounts) {
    const currency = normalizedCurrency(account.currency);
    if (currency) currencies.add(currency);
    else unknownCurrency = true;
  }
  for (const holding of purposeHoldings) {
    const currency = normalizedCurrency(holding.currency ?? holding.iso_currency_code) ?? accountCurrencyByPlaidId.get(holding.plaid_account_id);
    if (currency) currencies.add(currency);
    else unknownCurrency = true;
  }
  const mixedCurrency = currencies.size > 1 || unknownCurrency;
  const currency = currencies.size === 1 && !unknownCurrency ? [...currencies][0] : null;
  const currentValue = mixedCurrency ? null : sumBalances(purposeAccounts);
  const investedValue = mixedCurrency ? null : purposeHoldings.reduce((total, holding) => total + numericBalance(holding.institution_value), 0);
  const holdingsWithMetrics = purposeHoldings.map((holding) => {
    const value = numberOrNull(holding.institution_value);
    const costBasis = numberOrNull(holding.cost_basis);
    const gain = value != null && costBasis != null ? value - costBasis : null;
    return {
      ...holding,
      currency: holding.currency ?? holding.iso_currency_code ?? accountCurrencyByPlaidId.get(holding.plaid_account_id) ?? null,
      gain,
      gainPercent: gain != null && costBasis != null && costBasis > 0 ? (gain / costBasis) * 100 : null,
      allocationPercent: investedValue != null && investedValue > 0 && value != null ? (value / investedValue) * 100 : null,
    };
  });
  const knownGains = holdingsWithMetrics.filter((holding) => holding.gain != null);
  const totalGain = knownGains.length > 0 ? knownGains.reduce((total, holding) => total + (holding.gain ?? 0), 0) : null;
  const totalCostBasis = purposeHoldings.reduce((total, holding) => total + (numberOrNull(holding.cost_basis) ?? 0), 0);

  return {
    accounts: purposeAccounts,
    currentValue,
    investedValue,
    cashValue: currentValue != null && investedValue != null ? Math.max(0, currentValue - investedValue) : null,
    holdings: holdingsWithMetrics,
    totalGain: mixedCurrency ? null : totalGain,
    totalGainPercent: mixedCurrency ? null : totalGain != null && totalCostBasis > 0 ? (totalGain / totalCostBasis) * 100 : null,
    currency,
    currencies: [...currencies].sort(),
    mixedCurrency,
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
  const profile = normalizeFinancialProfile(suppliedProfile);
  const monthlyIncomeEstimate = estimateMonthlyBudgetIncome(profile);
  const monthlyExpenseEstimate = estimateMonthlyRecurringExpenses(profile);
  // Use the original input here: normalization can materialize legacy manualBalances as account rows.
  const profileAccountBalances = summarizeProfileAccountBalances(suppliedProfile);
  const estimatedRecurringCashFlow = monthlyIncomeEstimate.estimatedMonthlyTakeHomeIncome != null && monthlyExpenseEstimate.estimatedMonthlyExpenses != null
    ? monthlyIncomeEstimate.estimatedMonthlyTakeHomeIncome - monthlyExpenseEstimate.estimatedMonthlyExpenses
    : null;
  const accountsWithClass = accounts.map((account) => ({ ...account, accountClass: getDashboardAccountClass(account) }));
  const connectedAccountSummary = accounting.summarizeAccounts(accounts);
  const accountSummary = combineAccountSummaries(connectedAccountSummary, profileAccountBalances);
  const includePending = profile.budgetingPreferences?.includePendingTransactions;
  const monthly = accounting.computeMonthlyAccounting(monthTransactions, accounts, { includePending });
  const financialPlanning = calculateFinancialPlanning(profile, {
    actualMonthlySpending: monthly.currencySafe ? monthly.spending : undefined,
  });
  const cashAccounts = accountsWithClass.filter((account) => account.accountClass === "cash");
  const creditAccounts = accountsWithClass.filter((account) => account.accountClass === "credit");
  const retirementAccounts = accountsWithClass.filter((account) => account.accountClass === "retirement");
  const taxableInvestmentAccounts = accountsWithClass.filter((account) => account.accountClass === "investment");
  const retirementAssets = accounting.summarizeAccounts(retirementAccounts).investments;
  const netCashFlow = monthly.currencySafe && monthly.income > 0 ? monthly.income - monthly.spending : null;
  const savingsRate = netCashFlow != null && monthly.income > 0 ? (netCashFlow / monthly.income) * 100 : null;
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedMonthEndSpending = monthly.currencySafe && dayOfMonth >= 2 ? (monthly.spending / dayOfMonth) * daysInMonth : null;
  const hysaAccounts = accountsWithClass.filter((account) => getPurpose(account) === "hysa");
  const checkingAccounts = accountsWithClass.filter((account) => getPurpose(account) === "spending");
  const equitiesPosition = buildPortfolioPosition(accountsWithClass, holdings, "equities");
  const retirementPosition = buildPortfolioPosition(accountsWithClass, holdings, "retirement");
  const hysaSummary = accounting.summarizeAccounts(hysaAccounts);
  const canCombineHysaCash = hysaSummary.currency != null &&
    equitiesPosition.currency != null &&
    hysaSummary.currency === equitiesPosition.currency &&
    !hysaSummary.mixedCurrency &&
    equitiesPosition.cashValue != null;
  const venmoAccounts = accountsWithClass.filter((account) => getPurpose(account) === "venmo");
  const venmoCurrencies = new Set(
    venmoAccounts
      .map((account) => typeof account.currency === "string" && /^[A-Za-z]{3}$/.test(account.currency) ? account.currency.toUpperCase() : null)
  );
  const venmoCurrency = venmoCurrencies.size === 1 && !venmoCurrencies.has(null) ? [...venmoCurrencies][0] : null;
  const venmoBalance = venmoAccounts.length === 0 || venmoCurrencies.has(null) || venmoCurrencies.size > 1
    ? venmoAccounts.length === 0 ? 0 : null
    : venmoAccounts.reduce((total, account) => total + numericBalance(account.current_balance), 0);
  const configuredSpendingTarget = profile.budget?.monthlySpendingTarget ??
    (profile.budget?.expenses?.length ? profile.budget.expenses.reduce((total, line) => total + line.amount, 0) : undefined);

  return {
    accountSummary,
    connectedAccountSummary,
    profileAccountBalances,
    monthly,
    monthlyIncomeEstimate,
    monthlyExpenseEstimate,
    financialPlanning,
    properties: (profile.properties ?? []).map((property) => ({
      ...property,
      ownershipAdjustedValue: property.estimatedMarketValue == null
        ? null
        : property.estimatedMarketValue * property.ownershipPercentage / 100,
    })),
    debts: profile.debts ?? [],
    retirementContributionPlans: profile.retirementContributionPlans ?? [],
    goals: profile.goals ?? [],
    budgetLines: monthly.currencySafe ? accounting.getDashboardBudgetTotals(monthly.spendingByCategory) : [],
    accounts: accountsWithClass,
    cashAccounts,
    creditAccounts,
    taxableInvestmentAccounts,
    retirementAccounts,
    retirementAssets,
    netCashFlow,
    savingsRate,
    spendingBudgetUsage: configuredSpendingTarget == null || !monthly.currencySafe ? null : accounting.getBudgetUsagePercent(configuredSpendingTarget, monthly.spending),
    projectedMonthEndSpending,
    monthlyHistory: monthlyHistory(historicalTransactions, accounts, now, includePending),
    investmentPerformance: getInvestmentPerformance(holdings, snapshots, accounts, now),
    portfolioGrowth: buildPortfolioGrowthSeries(snapshots, accounts),
    overallPosition: {
      netWorth: accountSummary.netWorth,
      connectedNetWorth: connectedAccountSummary.netWorth,
      profileAccountNetWorth: profileAccountBalances.configured ? profileAccountBalances.netWorth : null,
      netWorthComplete: accountSummary.netWorth != null && (!profileAccountBalances.configured || profileAccountBalances.complete),
      checkingAccounts,
      checkingBalance: sumBalances(checkingAccounts),
    },
    financialPosition: {
      equities: equitiesPosition,
      retirement: retirementPosition,
      hysa: {
        accounts: hysaAccounts,
        currentBalance: hysaAccounts.length === 0
          ? equitiesPosition.cashValue
          : canCombineHysaCash
            ? (hysaSummary.cash ?? 0) + equitiesPosition.cashValue!
            : null,
        currency: hysaAccounts.length === 0 ? equitiesPosition.currency : canCombineHysaCash ? hysaSummary.currency : null,
        configuredApy: profile.bills?.intendedApy ?? null,
      },
    },
    weeklySpending: calculateWeeklySpending({
      asOf: now,
      transactions: weeklyTransactions,
      venmoBalance,
      venmoCurrency,
      accounts,
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
      estimatedRecurringCashFlow,
      recurringCashFlowComplete: estimatedRecurringCashFlow != null && monthlyIncomeEstimate.complete && monthlyExpenseEstimate.complete,
    },
  };
}
