import type { SupabaseClient } from "@supabase/supabase-js";
import { budgetDecision, financialBudget, type BudgetPolicy } from "./budgetEngine";
import { suggestTransactionClassification, suggestionConfidences, type SuggestionConfidence } from "./transactionClassification";
import {
  isBudgetCategory,
  weeklyMetrics,
  weekPeriod,
  type BudgetAccount,
  type BudgetTransaction,
} from "./discretionaryBudget";

export const transactionColumns =
  "id, account_id, plaid_transaction_id, date, name, merchant_name, amount, pending, category, normalized_category, category_override, weekly_budget_override, monthly_budget_override, transaction_currency, pending_transaction_id, plaid_primary_category, plaid_detailed_category, plaid_category_confidence";
export const accountColumns =
  "id, account_name, institution_name, currency, persistent_account_id, weekly_budget_source, created_at, account_type";
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
export async function listTransactionSuggestions(
  client: SupabaseClient,
  userId: string,
  params: URLSearchParams,
  accounts: BudgetAccount[],
  policy: BudgetPolicy,
) {
  const f = transactionFilters(params);
  const confidence = params.get("suggestion_confidence"),
    category = params.get("proposed_category"),
    review = params.get("review_status");
  if ((confidence && !suggestionConfidences.includes(confidence as SuggestionConfidence)) ||
      (category && !isBudgetCategory(category)) ||
      (review && !["reviewed", "unreviewed"].includes(review)))
    throw new TransactionInputError("Invalid suggestion filters");
  // Derived suggestions cannot be filtered by SQL without a schema change.
  // Scan only on the server, bounded at 10,000 rows, and return one 50-row page.
  const transactions: BudgetTransaction[] = [];
  let expectedCount: number | null = null;
  for (let offset = 0; offset <= 10000; offset += 500) {
    let query = client.from("transactions").select(transactionColumns, { count: "exact" }).eq("user_id", userId);
    if (f.account) query = query.eq("account_id", f.account);
    const { data, error, count } = await query.order("date", { ascending: false }).order("id", { ascending: false })
      .range(offset, Math.min(offset + 499, 10000));
    if (error || !Array.isArray(data)) throw new Error("Suggestion data unavailable");
    if (count == null || (expectedCount != null && count !== expectedCount))
      throw new Error("Suggestion coverage changed or is unavailable; retry");
    if (count > 10000) throw new TransactionAvailabilityError("VOLUME_LIMIT");
    expectedCount = count;
    transactions.push(...data as BudgetTransaction[]);
    if (transactions.length > 10000) throw new TransactionAvailabilityError("VOLUME_LIMIT");
    if (data.length < 500) break;
  }
  if (transactions.length !== expectedCount || new Set(transactions.map((t) => t.id)).size !== transactions.length)
    throw new Error("Suggestion coverage incomplete or changed; retry");
  const summary = { total: transactions.length, alreadyReviewed: 0, high: 0, medium: 0, ambiguous: 0, missingProviderMetadata: 0 };
  const postedLinks = new Set(transactions.filter((t) => t.pending === false && t.pending_transaction_id)
    .map((t) => `${t.account_id}:${t.pending_transaction_id}`));
  const seen = new Set<string>();
  const candidates = transactions.map((t) => {
    const account = accounts.find((a) => a.id === t.account_id);
    const suggestion = suggestTransactionClassification(t, account?.account_type);
    const reviewed = t.category_override != null;
    if (reviewed) summary.alreadyReviewed++;
    else if (suggestion.confidence === "high") summary.high++;
    else if (suggestion.confidence === "medium") summary.medium++;
    else summary.ambiguous++;
    if (!t.plaid_primary_category || !t.plaid_detailed_category || !t.plaid_category_confidence)
      summary.missingProviderMetadata++;
    const identity = t.plaid_transaction_id ? `plaid:${t.plaid_transaction_id}` : `row:${t.id}`;
    const replaced = t.pending === true && postedLinks.has(`${t.account_id}:${t.plaid_transaction_id}`);
    const duplicate = seen.has(identity);
    seen.add(identity);
    const impact = (period: "weekly" | "monthly") => {
      if (replaced || duplicate) return { kind: "exclude", reason: "Pending replacement or repeated provider transaction; not an additional expense." };
      if (suggestion.category === "needs_review") return { kind: "review", reason: "No supported category proposed; spending effect remains unverified." };
      const decision = budgetDecision({ ...t, category_override: suggestion.category }, accounts, policy, period);
      return { kind: decision.kind, reason: `${decision.reason}${Number(t.amount) < 0 ? " Hypothetical credit offset requires explicit approval; no refund is automatically matched." : ""}` };
    };
    return {
      transaction: { id: t.id, account_id: t.account_id, date: t.date, merchant_name: t.merchant_name, name: t.name,
        amount: t.amount, pending: t.pending, category: t.category, normalized_category: t.normalized_category,
        category_override: t.category_override, transaction_currency: t.transaction_currency },
      suggestion, reviewed, weekly: impact("weekly"), monthly: impact("monthly"),
    };
  });
  const filtered = candidates.filter((c) => (!confidence || c.suggestion.confidence === confidence) &&
    (!category || c.suggestion.category === category) && (!review || c.reviewed === (review === "reviewed")));
  const start = (f.page - 1) * 50;
  return {
    suggestions: filtered.slice(start, start + 50), summary, matching: filtered.length,
    page: f.page, hasMore: filtered.length > start + 50,
    accounts: accounts.map((a) => ({ id: a.id, account_name: a.account_name, institution_name: a.institution_name, currency: a.currency })),
  };
}
export type TransactionSuggestionsPage = Awaited<ReturnType<typeof listTransactionSuggestions>>;

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
  const metrics = Array.isArray(data.category_rules) && Array.isArray(data.account_rules)
    ? financialBudget(transactions, accounts, limit, { categories: data.category_rules, accounts: data.account_rules, monthly_limit: data.monthly_limit ?? null }, now).weekly
    : weeklyMetrics(transactions, accounts, limit, now);
  {
    const last = Array.isArray(data.jobs) ? data.jobs.find((job: { kind: string }) => job.kind === "sync")?.last_success_at : null;
    if (!last || now.getTime() - Date.parse(last) >= 86400000 || Date.parse(last) > now.getTime() || !Number.isFinite(Date.parse(last))) {
      metrics.provisional = true; metrics.safeRemaining = null; metrics.suggestedDaily = null;
    }
  }
  return {
    metrics,
    accounts,
    freshness: { lastSyncAt: Array.isArray(data.jobs) ? data.jobs.find((job: { kind: string }) => job.kind === "sync")?.last_success_at ?? null : null },
  };
}
