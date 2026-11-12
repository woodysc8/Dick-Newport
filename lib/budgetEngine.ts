import {
  accountSources,
  discretionary,
  transactionDecision,
  weeklyMetrics,
  weekPeriod,
  type BudgetCategory,
  type BudgetAccount,
  type BudgetTransaction,
} from "./discretionaryBudget";
import { classifyTransaction } from "./transactionClassification";

export type CategoryRule = {
  category: BudgetCategory;
  weekly_included: boolean | null;
  monthly_included: boolean | null;
  monthly_group: "fixed" | "essential" | "discretionary" | "excluded" | null;
  weekly_cap: number | null;
  monthly_cap: number | null;
};
export type AccountRule = {
  account_id: string;
  weekly_included: boolean | null;
  monthly_included: boolean | null;
};
export type BudgetPolicy = {
  categories: CategoryRule[];
  accounts: AccountRule[];
  monthly_limit: number | null;
};
export const emptyPolicy: BudgetPolicy = {
  categories: [],
  accounts: [],
  monthly_limit: null,
};
const movements = new Set<BudgetCategory>([
  "transfer",
  "card_payment",
  "investment",
  "savings",
  "income",
  "debt_payment",
]);
export function monthPeriod(now = new Date()) {
  const today = weekPeriod(now).today;
  const year = Number(today.slice(0, 4)),
    month = Number(today.slice(5, 7));
  const date = (offset: number) =>
    new Date(Date.UTC(year, month - 1 + offset, 1, 12))
      .toISOString()
      .slice(0, 10);
  return { start: date(0), end: date(1), previousStart: date(-1), today };
}
export function budgetDecision(
  t: BudgetTransaction,
  accounts: readonly BudgetAccount[],
  policy: BudgetPolicy,
  period: "weekly" | "monthly",
  sourceState?: {
    sources: ReturnType<typeof accountSources>;
    accountMap: Map<string, BudgetAccount>;
  },
) {
  const classification = classifyTransaction(t);
  const category = classification.category;
  const categoryRule = policy.categories.find((r) => r.category === category);
  const accountRule = policy.accounts.find(
    (r) => r.account_id === t.account_id,
  );
  const explicit =
    period === "weekly" ? t.weekly_budget_override : t.monthly_budget_override;
  const account =
    period === "weekly"
      ? accountRule?.weekly_included
      : accountRule?.monthly_included;
  const rule =
    period === "weekly"
      ? categoryRule?.weekly_included
      : categoryRule?.monthly_included;
  const included =
    explicit != null
      ? explicit === "include"
      : rule != null && (movements.has(category) || category === "needs_review")
        ? rule
        : category === "needs_review"
          ? false
          : movements.has(category)
            ? false
            : account != null
              ? account
              : rule != null
                ? rule
                : period === "weekly"
                  ? discretionary.has(category)
                  : true;
  const transformed = {
    ...t,
    normalized_category: category,
    weekly_budget_override: (explicit === "exclude" ||
    (!included && category !== "needs_review")
      ? "exclude"
      : included
        ? "include"
        : null) as BudgetTransaction["weekly_budget_override"],
  };
  // Automatic inclusion must not turn unmatched refunds into budget credits.
  if (Number(t.amount) < 0 && explicit !== "include" && !t.category_override)
    transformed.weekly_budget_override = null;
  const decision = transactionDecision(
    transformed,
    accounts,
    sourceState?.sources,
    sourceState?.accountMap,
  );
  const group =
    categoryRule?.monthly_group ??
    (movements.has(category)
      ? "excluded"
      : discretionary.has(category)
        ? "discretionary"
        : [
              "housing",
              "insurance",
              "utilities",
              "fixed",
              "subscriptions",
            ].includes(category)
          ? "fixed"
          : "essential");
  return {
    ...decision,
    classification,
    group,
    reason: `${decision.reason} Precedence: source/currency safety, transaction override, account rule, category rule, default.`,
    included,
  };
}
export function financialBudget(
  transactions: readonly BudgetTransaction[],
  accounts: readonly BudgetAccount[],
  weeklyLimit: number | null,
  policy = emptyPolicy,
  now = new Date(),
) {
  const sources = accountSources(accounts),
    accountMap = new Map(accounts.map((a) => [a.id, a]));
  const sourceState = { sources, accountMap };
  const prepared = transactions.map((t) => {
    const d = budgetDecision(t, accounts, policy, "weekly", sourceState);
    return {
      ...t,
      normalized_category: d.category,
      weekly_budget_override: (d.kind === "include"
        ? Number(t.amount) < 0 &&
          !t.category_override &&
          t.weekly_budget_override !== "include"
          ? null
          : "include"
        : d.kind === "exclude"
          ? "exclude"
          : t.weekly_budget_override) as BudgetTransaction["weekly_budget_override"],
    };
  });
  const weekly = weeklyMetrics(prepared, accounts, weeklyLimit, now),
    month = monthPeriod(now);
  const links = new Set(
    transactions
      .filter((t) => t.pending === false && t.pending_transaction_id)
      .map((t) => `${t.account_id}:${t.pending_transaction_id}`),
  );
  const seen = new Set<string>();
  let gross = 0,
    credits = 0,
    pending = 0,
    review = 0,
    reviewCount = 0,
    excluded = 0,
    currencyCount = 0,
    previous = 0,
    inflow = 0,
    outflow = 0,
    income = 0,
    transfers = 0,
    cardPayments = 0;
  const groups = { fixed: 0, essential: 0, discretionary: 0, excluded: 0 };
  const breakdown: Partial<Record<BudgetCategory, number>> = {};
  for (const t of transactions) {
    if (t.date < month.previousStart || t.date >= month.end) continue;
    if (t.pending && links.has(`${t.account_id}:${t.plaid_transaction_id}`))
      continue;
    const identity = t.plaid_transaction_id
      ? `plaid:${t.plaid_transaction_id}`
      : `row:${t.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const d = budgetDecision(t, accounts, policy, "monthly", sourceState),
      amount = Math.round(Number(t.amount) * 100),
      current = t.date >= month.start;
    if (
      current &&
      d.kind !== "currency" &&
      t.pending === false &&
      sources.get(t.account_id ?? "") === "include" &&
      Number.isFinite(amount)
    ) {
      if (amount > 0) outflow += amount;
      else inflow -= amount;
      if (d.category === "income" && amount < 0) income -= amount;
      if (d.category === "transfer") transfers += Math.abs(amount);
      if (d.category === "card_payment") cardPayments += Math.abs(amount);
    }
    if (d.kind === "include" && Number.isFinite(amount)) {
      if (t.pending) {
        if (current && amount > 0) pending += amount;
      } else if (current) {
        if (amount >= 0) gross += amount;
        else credits -= amount;
        groups[d.group] += amount;
        breakdown[d.category] = (breakdown[d.category] ?? 0) + amount;
      } else if (!t.pending) previous += amount;
    } else if (current) {
      if (d.kind === "currency") currencyCount++;
      if (d.kind === "review") {
        reviewCount++;
        if (Number.isFinite(amount) && amount > 0) review += amount;
      }
      if (d.kind === "exclude" && Number.isFinite(amount) && amount > 0)
        excluded += amount;
    }
  }
  const posted = Math.max(0, gross - credits) / 100;
  const provisional =
    accounts.length === 0 ||
    reviewCount > 0 ||
    currencyCount > 0 ||
    [...sources.values()].some((s) => s === "review");
  const caps = policy.categories.map((rule) => ({
    category: rule.category,
    weekly_limit: rule.weekly_cap,
    weekly_spent: Math.max(0, weekly.breakdown[rule.category] ?? 0),
    monthly_limit: rule.monthly_cap,
    monthly_spent: Math.max(0, breakdown[rule.category] ?? 0) / 100,
  }));
  return {
    weekly,
    monthly: {
      ...month,
      limit: policy.monthly_limit,
      posted,
      grossSpending: gross / 100,
      eligibleCredits: credits / 100,
      transfers: transfers / 100,
      cardPayments: cardPayments / 100,
      pending: pending / 100,
      review: review / 100,
      reviewCount,
      excluded: excluded / 100,
      currencyCount,
      provisional,
      remaining:
        policy.monthly_limit == null
          ? null
          : (Math.round(policy.monthly_limit * 100) -
              Math.round(posted * 100)) /
            100,
      previousCompleteMonth: Math.max(0, previous) / 100,
      groups: Object.fromEntries(
        Object.entries(groups).map(([key, value]) => [
          key,
          Math.max(0, value) / 100,
        ]),
      ),
      income: income / 100,
      cashflow: {
        inflow: inflow / 100,
        outflow: outflow / 100,
        net: (inflow - outflow) / 100,
      },
      breakdown: Object.fromEntries(
        Object.entries(breakdown).map(([key, value]) => [key, value / 100]),
      ),
    },
    caps,
  };
}
