import type { SupabaseClient } from "@supabase/supabase-js";
import {
  financialBudget,
  monthPeriod,
  type BudgetPolicy,
} from "./budgetEngine";
import {
  weekPeriod,
  type BudgetAccount,
  type BudgetTransaction,
} from "./discretionaryBudget";
import { TransactionAvailabilityError } from "./transactionData";
import { calculateFinancialPlanning } from "./financialPlanning";
import { normalizeFinancialProfile } from "./financialProfileNormalization";
import type { FinancialProfile } from "./financialProfileDefaults";
import type { DashboardAccount, InvestmentHolding } from "./dashboard";

export type FinancialSnapshot = {
  user_id: string;
  transactions: BudgetTransaction[];
  accounts: (BudgetAccount & {
    account_type?: string;
    current_balance?: number | null;
  })[];
  weekly_limit: number | null;
  monthly_limit: number | null;
  category_rules: BudgetPolicy["categories"];
  account_rules: BudgetPolicy["accounts"];
  sync_in_progress: boolean;
  planning_profile?: FinancialProfile | null;
  jobs: {
    kind: "sync" | "briefing";
    last_attempt_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
  }[];
};
export async function loadBudgetPolicy(
  client: SupabaseClient,
  userId: string,
): Promise<BudgetPolicy> {
  const { data, error } = await client.rpc("financial_budget_policy");
  if (
    error ||
    !data ||
    data.user_id !== userId ||
    !Array.isArray(data.categories) ||
    !Array.isArray(data.accounts)
  )
    throw new Error("Budget policy unavailable");
  return {
    categories: data.categories,
    accounts: data.accounts,
    monthly_limit:
      data.monthly_limit == null ? null : Number(data.monthly_limit),
  };
}
export async function loadFinancialBudget(
  client: SupabaseClient,
  userId: string,
  now = new Date(),
  scheduled = false,
  includeBriefingDetails = false,
) {
  const month = monthPeriod(now),
    week = weekPeriod(now);
  const { data, error } = await client.rpc(
    scheduled
      ? "scheduled_financial_budget_snapshot"
      : "financial_budget_snapshot",
    {
      ...(scheduled ? { owner_id: userId } : {}),
      start_date:
        month.previousStart < week.previousStart
          ? month.previousStart
          : week.previousStart,
      end_date: month.end > week.end ? month.end : week.end,
    },
  );
  if (
    error ||
    !data ||
    data.user_id !== userId ||
    !Array.isArray(data.accounts) ||
    !Array.isArray(data.transactions) ||
    !Array.isArray(data.category_rules) ||
    !Array.isArray(data.account_rules) ||
    !Array.isArray(data.jobs)
  )
    throw new Error("Financial snapshot unavailable");
  const snapshot = data as FinancialSnapshot;
  if (snapshot.sync_in_progress)
    throw new TransactionAvailabilityError("SYNC_IN_PROGRESS");
  if (snapshot.transactions.length > 10000 || snapshot.accounts.length > 500)
    throw new TransactionAvailabilityError("VOLUME_LIMIT");
  for (const limit of [snapshot.weekly_limit, snapshot.monthly_limit])
    if (limit != null && (!Number.isFinite(Number(limit)) || Number(limit) < 0))
      throw new Error("Invalid financial limit");
  const policy: BudgetPolicy = {
    categories: snapshot.category_rules,
    accounts: snapshot.account_rules,
    monthly_limit:
      snapshot.monthly_limit == null ? null : Number(snapshot.monthly_limit),
  };
  const result = financialBudget(
    snapshot.transactions,
    snapshot.accounts,
    snapshot.weekly_limit == null ? null : Number(snapshot.weekly_limit),
    policy,
    now,
  );
  const lastSync = snapshot.jobs.find(
    (job) => job.kind === "sync",
  )?.last_success_at;
  const stale =
    !lastSync ||
    !Number.isFinite(Date.parse(lastSync)) ||
    Date.parse(lastSync) > now.getTime() ||
    now.getTime() - Date.parse(lastSync) >= 86400000;
  if (stale) {
    result.weekly.provisional = true;
    result.weekly.safeRemaining = null;
    result.weekly.suggestedDaily = null;
    result.monthly.provisional = true;
  }
  let planning: { income: number | null; recurring: number | null } | null =
    null;
  if (snapshot.planning_profile?.currency === "USD") {
    const planned = calculateFinancialPlanning(
      normalizeFinancialProfile(snapshot.planning_profile),
    );
    planning = {
      income: planned.income.estimatedMonthlyTakeHomeIncome,
      recurring: planned.recurringExpenses.estimatedMonthlyExpenses,
    };
  }
  let briefingDetails: {
    accounts: DashboardAccount[] | null;
    holdings: InvestmentHolding[] | null;
  } | null = null;
  if (includeBriefingDetails) {
    const [accounts, holdings] = await Promise.all([
      client.from("accounts")
        .select("id, account_name, account_type, account_subtype, institution_name, current_balance, available_balance, currency, plaid_account_id, persistent_account_id, created_at")
        .eq("user_id", userId).order("id").limit(501),
      client.from("investment_holdings")
        .select("id, plaid_account_id, ticker_symbol, security_name, quantity, institution_value, cost_basis, currency, iso_currency_code")
        .eq("user_id", userId).order("id").limit(201),
    ]);
    briefingDetails = {
      accounts: accounts.error || (accounts.data?.length ?? 0) > 500 ? null : (accounts.data ?? []).map((a) => ({ ...a, mask: null })) as DashboardAccount[],
      holdings: holdings.error || (holdings.data?.length ?? 0) > 200 ? null : holdings.data as InvestmentHolding[],
    };
  }
  return {
    ...result,
    briefingDetails,
    planning,
    stale,
    lastSync: lastSync ?? null,
    policy,
    snapshot,
  };
}
