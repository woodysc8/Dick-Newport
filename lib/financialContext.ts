import type { SupabaseClient } from "@supabase/supabase-js";
import accounting from "./accounting";
import { loadFinancialBudget } from "./financialBudgetData";
import {
  DashboardAccount,
  InvestmentHolding,
  InvestmentSnapshot,
  RecentTransaction,
  isDashboardInvestmentAccount,
  rewardBalances,
} from "./dashboard";

export type FinancialContextOptions = {
  includeSnapshots?: boolean;
  transactionLimit?: number;
};

type SourceStatus = "available" | "unavailable";

export type FinancialContext = {
  budget: { weekly: Awaited<ReturnType<typeof loadFinancialBudget>>["weekly"]; monthly: Awaited<ReturnType<typeof loadFinancialBudget>>["monthly"] } | null;
  generatedAt: string;
  netWorth: {
    total: number | null;
    cash: number | null;
    creditCardDebt: number | null;
    investments: number | null;
    currency: string | null;
    currencySafe: boolean;
    complete: boolean;
  };
  accounts: Array<{
    institution: string | null;
    name: string | null;
    type: string | null;
    subtype: string | null;
    mask: string | null;
    balance: number | string | null;
    availableBalance: number | string | null;
    currency: string | null;
    isInvestment: boolean;
  }>;
  investments: {
    totalValue: number | null;
    currency: string | null;
    currencySafe: boolean;
    complete: boolean;
    holdings: Array<{
      ticker: string | null;
      name: string | null;
      quantity: number | string | null;
      price: number | string | null;
      value: number | string | null;
      costBasis: number | string | null;
      currency: string | null;
    }>;
    snapshots?: Array<{
      date: string;
      portfolioValue: number | string;
      createdAt: string;
      currency: string | null;
    }>;
  };
  monthly: {
    currency: string | null;
    currencySafe: boolean;
    income: number | null;
    grossSpending: number | null;
    netPersonalSpending: number | null;
    refunds: number | null;
    transfers: number | null;
    creditCardPayments: number | null;
    categories: Record<string, number>;
  };
  recentTransactions: Array<{
    id: string;
    date: string;
    name: string | null;
    merchantName: string | null;
    amount: number | string | null;
    category: string | string[] | null;
    pending: boolean | null;
    currency: string | null;
  }>;
  rewards: {
    biltPoints: number | null;
    biltCash: number | null;
    barclaysPoints: number | null;
  };
  freshness: {
    lastRefreshAt: string | null;
    sourceStatuses: Record<string, SourceStatus>;
  };
};

function sourceStatus(error: unknown): SourceStatus {
  return error ? "unavailable" : "available";
}

export async function getFinancialContext(
  supabase: SupabaseClient,
  userId: string,
  options: FinancialContextOptions = {}
): Promise<FinancialContext> {
  const transactionLimit = Math.min(Math.max(options.transactionLimit ?? 50, 1), 200);
  const accountsQuery = supabase
    .from("accounts")
    .select("id, institution_name, account_name, mask, account_type, account_subtype, current_balance, available_balance, currency, plaid_account_id, plaid_item_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const recentTransactionsQuery = supabase
    .from("transactions")
    .select("id, date, name, merchant_name, amount, category, pending, plaid_transaction_id, account_id")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(transactionLimit);
  const holdingsQuery = supabase
    .from("investment_holdings")
    .select("id, plaid_account_id, security_id, ticker_symbol, security_name, quantity, institution_price, institution_value, cost_basis, currency, iso_currency_code")
    .eq("user_id", userId)
    .order("institution_value", { ascending: false });
  const [accountsResult, recentTransactionsResult, holdingsResult] = await Promise.all([
    accountsQuery,
    recentTransactionsQuery,
    holdingsQuery,
  ]);

  if (accountsResult.error || recentTransactionsResult.error || holdingsResult.error) {
    throw new Error("Failed to load financial context");
  }

  const accounts = (accountsResult.data ?? []) as DashboardAccount[];
  const recentTransactions = (recentTransactionsResult.data ?? []) as RecentTransaction[];
  const holdings = (holdingsResult.data ?? []) as InvestmentHolding[];
  const accountSummary = accounting.summarizeAccounts(accounts);
  const accountAggregatesComplete = accountSummary.netWorth != null && accountSummary.currency != null && !accountSummary.mixedCurrency;

  const context: FinancialContext = {
    budget: null,
    generatedAt: new Date().toISOString(),
    netWorth: {
      total: accountSummary.netWorth,
      cash: accountSummary.cash,
      creditCardDebt: accountSummary.credit,
      investments: accountSummary.investments,
      currency: accountSummary.currency,
      currencySafe: accountSummary.currency != null && !accountSummary.mixedCurrency,
      complete: accountAggregatesComplete,
    },
    accounts: accounts.map((account) => ({
      institution: account.institution_name,
      name: account.account_name,
      type: account.account_type,
      subtype: account.account_subtype,
      mask: account.mask,
      balance: account.current_balance,
      availableBalance: account.available_balance,
      currency: account.currency ?? null,
      isInvestment: isDashboardInvestmentAccount(account),
    })),
    investments: {
      totalValue: accountSummary.investments,
      currency: accountSummary.currency,
      currencySafe: accountSummary.currency != null && !accountSummary.mixedCurrency,
      complete: accountSummary.investments != null && accountSummary.currency != null && !accountSummary.mixedCurrency,
      holdings: holdings.map((holding) => ({
        ticker: holding.ticker_symbol,
        name: holding.security_name,
        quantity: holding.quantity,
        price: holding.institution_price,
        value: holding.institution_value,
        costBasis: holding.cost_basis,
        currency: holding.currency ?? holding.iso_currency_code ?? null,
      })),
    },
    monthly: {
      currency: null,
      currencySafe: false,
      income: null,
      grossSpending: null,
      netPersonalSpending: null,
      refunds: null,
      transfers: null,
      creditCardPayments: null,
      categories: {},
    },
    recentTransactions: recentTransactions.map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      name: transaction.name,
      merchantName: transaction.merchant_name,
      amount: transaction.amount,
      category: transaction.category,
      pending: transaction.pending,
      currency: (() => {
        const account = accounts.find((candidate) => candidate.id === transaction.account_id) ??
          accounts.find((candidate) => candidate.plaid_account_id === transaction.account_id);
        return account?.currency ?? null;
      })(),
    })),
    rewards: {
      biltPoints: rewardBalances.find((reward) => reward.label === "Bilt Points")?.value ?? null,
      biltCash: rewardBalances.find((reward) => reward.label === "Bilt Cash")?.value ?? null,
      barclaysPoints: rewardBalances.find((reward) => reward.label === "Barclays Points")?.value ?? null,
    },
    freshness: {
      lastRefreshAt: null,
      sourceStatuses: {
        accounts: sourceStatus(accountsResult.error),
        monthlyTransactions: "unavailable",
        recentTransactions: sourceStatus(recentTransactionsResult.error),
        investments: sourceStatus(holdingsResult.error),
        // plaid_items intentionally has no user-facing RLS policy.
        plaid: "unavailable",
      },
    },
  };

  if (options.includeSnapshots) {
    const { data: snapshots, error } = await supabase
      .from("investment_snapshots")
      .select("snapshot_date, portfolio_value, plaid_account_id, created_at")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: false });

    if (error) {
      context.freshness.sourceStatuses.investmentSnapshots = "unavailable";
    } else {
      context.investments.snapshots = ((snapshots ?? []) as Pick<InvestmentSnapshot, "snapshot_date" | "portfolio_value" | "plaid_account_id" | "created_at">[]).flatMap((snapshot) => (
        snapshot.portfolio_value == null
          ? []
          : [{
              date: snapshot.snapshot_date,
              portfolioValue: snapshot.portfolio_value,
              createdAt: snapshot.created_at,
              currency: accounts.find((account) => account.plaid_account_id === snapshot.plaid_account_id)?.currency ?? null,
            }]
      ));
      context.freshness.sourceStatuses.investmentSnapshots = "available";
    }
  }

  // Canonical budgeting is shared with the dashboard and private export. A
  // missing migration does not manufacture a competing monthly spending total.
  try {
    const budget = await loadFinancialBudget(supabase, userId);
    context.budget = { weekly: budget.weekly, monthly: budget.monthly };
    context.monthly.netPersonalSpending = budget.monthly.posted;
    context.monthly.income = budget.monthly.income;
    context.monthly.grossSpending = budget.monthly.grossSpending;
    context.monthly.refunds = budget.monthly.eligibleCredits;
    context.monthly.transfers = budget.monthly.transfers;
    context.monthly.creditCardPayments = budget.monthly.cardPayments;
    context.monthly.categories = budget.monthly.breakdown;
    context.monthly.currency = "USD";
    context.monthly.currencySafe = budget.monthly.currencyCount === 0;
    context.freshness.lastRefreshAt = budget.snapshot.jobs.find((j) => j.kind === "sync")?.last_success_at ?? null;
    context.freshness.sourceStatuses.budget = "available";
    context.freshness.sourceStatuses.monthlyTransactions = "available";
  } catch {
    context.monthly.netPersonalSpending = null;
    context.monthly.categories = {};
    context.freshness.sourceStatuses.budget = "unavailable";
    context.freshness.sourceStatuses.monthlyTransactions = "unavailable";
  }
  return context;
}
