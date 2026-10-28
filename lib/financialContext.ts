import type { SupabaseClient } from "@supabase/supabase-js";
import accounting from "./accounting";
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
  generatedAt: string;
  netWorth: {
    total: number | null;
    cash: number | null;
    creditCardDebt: number | null;
    investments: number | null;
  };
  accounts: Array<{
    institution: string | null;
    name: string | null;
    type: string | null;
    subtype: string | null;
    mask: string | null;
    balance: number | string | null;
    availableBalance: number | string | null;
    isInvestment: boolean;
  }>;
  investments: {
    totalValue: number | null;
    holdings: Array<{
      ticker: string | null;
      name: string | null;
      quantity: number | string | null;
      price: number | string | null;
      value: number | string | null;
      costBasis: number | string | null;
    }>;
    snapshots?: Array<{
      date: string;
      portfolioValue: number | string;
      createdAt: string;
    }>;
  };
  monthly: {
    income: number;
    grossSpending: number;
    netPersonalSpending: number;
    refunds: number;
    transfers: number;
    creditCardPayments: number;
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

function currentMonthRange() {
  const now = new Date();
  return {
    monthStart: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10),
    monthEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10),
  };
}

function sourceStatus(error: unknown): SourceStatus {
  return error ? "unavailable" : "available";
}

export async function getFinancialContext(
  supabase: SupabaseClient,
  userId: string,
  options: FinancialContextOptions = {}
): Promise<FinancialContext> {
  const { monthStart, monthEnd } = currentMonthRange();
  const transactionLimit = Math.min(Math.max(options.transactionLimit ?? 50, 1), 200);
  const accountsQuery = supabase
    .from("accounts")
    .select("institution_name, account_name, mask, account_type, account_subtype, current_balance, available_balance, plaid_account_id, plaid_item_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const monthlyTransactionsQuery = supabase
    .from("transactions")
    .select("id, date, name, merchant_name, amount, category, pending, plaid_transaction_id, account_id")
    .eq("user_id", userId)
    .gte("date", monthStart)
    .lte("date", monthEnd)
    .order("date", { ascending: false });
  const recentTransactionsQuery = supabase
    .from("transactions")
    .select("id, date, name, merchant_name, amount, category, pending, plaid_transaction_id, account_id")
    .eq("user_id", userId)
    .order("date", { ascending: false })
    .limit(transactionLimit);
  const holdingsQuery = supabase
    .from("investment_holdings")
    .select("id, plaid_account_id, security_id, ticker_symbol, security_name, quantity, institution_price, institution_value, cost_basis")
    .eq("user_id", userId)
    .order("institution_value", { ascending: false });
  const [accountsResult, monthlyTransactionsResult, recentTransactionsResult, holdingsResult] = await Promise.all([
    accountsQuery,
    monthlyTransactionsQuery,
    recentTransactionsQuery,
    holdingsQuery,
  ]);

  if (accountsResult.error || monthlyTransactionsResult.error || recentTransactionsResult.error || holdingsResult.error) {
    throw new Error("Failed to load financial context");
  }

  const accounts = (accountsResult.data ?? []) as DashboardAccount[];
  const monthlyTransactions = (monthlyTransactionsResult.data ?? []) as RecentTransaction[];
  const recentTransactions = (recentTransactionsResult.data ?? []) as RecentTransaction[];
  const holdings = (holdingsResult.data ?? []) as InvestmentHolding[];
  const accountSummary = accounting.summarizeAccounts(accounts);
  const monthly = accounting.computeMonthlyAccounting(monthlyTransactions, accounts);
  const categories = Object.fromEntries(monthly.spendingByCategory.map(({ category, total }) => [category, total]));

  const context: FinancialContext = {
    generatedAt: new Date().toISOString(),
    netWorth: {
      total: accountSummary.netWorth,
      cash: accountSummary.cash,
      creditCardDebt: accountSummary.credit,
      investments: accountSummary.investments,
    },
    accounts: accounts.map((account) => ({
      institution: account.institution_name,
      name: account.account_name,
      type: account.account_type,
      subtype: account.account_subtype,
      mask: account.mask,
      balance: account.current_balance,
      availableBalance: account.available_balance,
      isInvestment: isDashboardInvestmentAccount(account),
    })),
    investments: {
      totalValue: accountSummary.investments,
      holdings: holdings.map((holding) => ({
        ticker: holding.ticker_symbol,
        name: holding.security_name,
        quantity: holding.quantity,
        price: holding.institution_price,
        value: holding.institution_value,
        costBasis: holding.cost_basis,
      })),
    },
    monthly: {
      income: monthly.income,
      grossSpending: monthly.grossSpending,
      netPersonalSpending: monthly.spending,
      refunds: monthly.refunds,
      transfers: monthly.transfers,
      creditCardPayments: monthly.creditCardPayments,
      categories,
    },
    recentTransactions: recentTransactions.map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      name: transaction.name,
      merchantName: transaction.merchant_name,
      amount: transaction.amount,
      category: transaction.category,
      pending: transaction.pending,
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
        monthlyTransactions: sourceStatus(monthlyTransactionsResult.error),
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
      .select("snapshot_date, portfolio_value, created_at")
      .eq("user_id", userId)
      .order("snapshot_date", { ascending: false });

    if (error) {
      context.freshness.sourceStatuses.investmentSnapshots = "unavailable";
    } else {
      context.investments.snapshots = ((snapshots ?? []) as Pick<InvestmentSnapshot, "snapshot_date" | "portfolio_value" | "created_at">[]).flatMap((snapshot) => (
        snapshot.portfolio_value == null
          ? []
          : [{
              date: snapshot.snapshot_date,
              portfolioValue: snapshot.portfolio_value,
              createdAt: snapshot.created_at,
            }]
      ));
      context.freshness.sourceStatuses.investmentSnapshots = "available";
    }
  }

  return context;
}
