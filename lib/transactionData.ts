import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isBudgetCategory,
  weeklyMetrics,
  weekPeriod,
  type BudgetAccount,
  type BudgetTransaction,
} from "./discretionaryBudget";

export const transactionColumns =
  "id, account_id, plaid_transaction_id, date, name, merchant_name, amount, pending, category, normalized_category, category_override, weekly_budget_override, transaction_currency, pending_transaction_id, plaid_primary_category, plaid_detailed_category, plaid_category_confidence";
export const accountColumns =
  "id, account_name, institution_name, currency, persistent_account_id, weekly_budget_source, created_at";
export const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export class TransactionInputError extends Error {}
export class TransactionAvailabilityError extends Error {
  constructor(code: "SYNC_IN_PROGRESS" | "VOLUME_LIMIT") {
    super(
      code === "SYNC_IN_PROGRESS"
        ? "Financial data is still being imported. Wait for refresh to finish, then retry weekly spending."
        : "Weekly budget data exceeds the supported volume. Ask the administrator to review the aggregation limit; no partial total is shown.",
    );
  }
}
export function transactionFilters(params: URLSearchParams) {
  const page = Number(params.get("page") ?? 1),
    q = params.get("q") ?? "",
    account = params.get("account"),
    category = params.get("category"),
    status = params.get("status");
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    page > 1000 ||
    q.length > 100 ||
    (account && !uuid(account)) ||
    (category && !isBudgetCategory(category)) ||
    (status && !["pending", "posted"].includes(status))
  )
    throw new TransactionInputError("Invalid transaction filters");
  const start = params.get("start"),
    end = params.get("end");
  for (const date of [start, end])
    if (
      date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date)
    )
      throw new TransactionInputError("Invalid date filter");
  if (start && end && start > end)
    throw new TransactionInputError("Start date must precede end date");
  return {
    page,
    q: q.replace(/[^\p{L}\p{N}\s'-]/gu, " ").trim(),
    account,
    category,
    status,
    start,
    end,
  };
}
export async function listAccounts(client: SupabaseClient, userId: string) {
  const { data, error } = await client
    .from("accounts")
    .select(accountColumns)
    .eq("user_id", userId)
    .order("id")
    .limit(501);
  if (error || (data?.length ?? 0) > 500)
    throw new Error("Account data unavailable");
  return (data ?? []) as BudgetAccount[];
}
export async function listTransactions(
  client: SupabaseClient,
  userId: string,
  params: URLSearchParams,
) {
  const f = transactionFilters(params);
  let query = client
    .from("transactions")
    .select(transactionColumns)
    .eq("user_id", userId);
  if (f.q) query = query.or(`merchant_name.ilike.*${f.q}*,name.ilike.*${f.q}*`);
  if (f.account) query = query.eq("account_id", f.account);
  if (f.category)
    query = query.or(
      `category_override.eq.${f.category},and(category_override.is.null,normalized_category.eq.${f.category})`,
    );
  if (f.status) query = query.eq("pending", f.status === "pending");
  if (f.start) query = query.gte("date", f.start);
  if (f.end) query = query.lte("date", f.end);
  const { data, error } = await query
    .order("date", { ascending: false })
    .order("id", { ascending: false })
    .range((f.page - 1) * 50, f.page * 50);
  if (error) throw new Error("Transaction data unavailable");
  return {
    transactions: (data ?? []).slice(0, 50) as BudgetTransaction[],
    hasMore: (data?.length ?? 0) > 50,
    page: f.page,
  };
}
export async function loadWeeklyBudget(
  client: SupabaseClient,
  userId: string,
  now = new Date(),
) {
  const period = weekPeriod(now);
  const { data, error } = await client.rpc("weekly_budget_snapshot", {
    start_date: period.previousStart,
    end_date: period.end,
  });
  if (
    error ||
    !data ||
    data.user_id !== userId ||
    !Array.isArray(data.accounts) ||
    !Array.isArray(data.transactions)
  )
    throw new Error("Weekly snapshot unavailable");
  if (data.sync_in_progress)
    throw new TransactionAvailabilityError("SYNC_IN_PROGRESS");
  if (data.transactions.length > 10000 || data.accounts.length > 500)
    throw new TransactionAvailabilityError("VOLUME_LIMIT");
  const accounts = data.accounts as BudgetAccount[],
    transactions = data.transactions as BudgetTransaction[];
  const limit = data.weekly_limit == null ? null : Number(data.weekly_limit);
  if (limit != null && (!Number.isFinite(limit) || limit < 0))
    throw new Error("Invalid budget limit");
  return {
    metrics: weeklyMetrics(transactions, accounts, limit, now),
    accounts,
  };
}
