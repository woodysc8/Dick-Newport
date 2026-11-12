export const categories = {
  dining: "Restaurants, takeout & delivery",
  coffee: "Coffee & cafes",
  nightlife: "Bars & nightlife",
  groceries: "Groceries",
  shopping: "Shopping & retail",
  entertainment: "Entertainment & recreation",
  hobbies: "Hobbies",
  personal: "Personal purchases",
  other_discretionary: "Other discretionary",
  housing: "Rent & mortgage",
  utilities: "Utilities",
  insurance: "Insurance",
  debt_payment: "Loan payments",
  card_payment: "Credit-card payments",
  transfer: "Transfers",
  investment: "Investment movements",
  savings: "Savings",
  tax: "Taxes",
  income: "Income",
  fixed: "Other fixed obligations",
  gas: "Gas & fuel",
  household: "Household supplies",
  personal_care: "Personal care",
  healthcare: "Healthcare",
  subscriptions: "Subscriptions",
  needs_review: "Needs review",
} as const;
export type BudgetCategory = keyof typeof categories;
export const discretionary = new Set<BudgetCategory>([
  "dining",
  "coffee",
  "nightlife",
  "groceries",
  "shopping",
  "entertainment",
  "hobbies",
  "personal",
  "other_discretionary",
]);
export function isBudgetCategory(value: unknown): value is BudgetCategory {
  return typeof value === "string" && Object.hasOwn(categories, value);
}
export type BudgetAccount = {
  id: string;
  account_name: string;
  institution_name: string;
  currency: string | null;
  persistent_account_id: string | null;
  weekly_budget_source: "review" | "include" | "exclude";
  created_at: string;
};
export type BudgetTransaction = {
  id: string;
  account_id: string | null;
  plaid_transaction_id: string | null;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number | string | null;
  pending: boolean | null;
  category: string | null;
  normalized_category: BudgetCategory;
  category_override: BudgetCategory | null;
  weekly_budget_override: "include" | "exclude" | null;
  monthly_budget_override?: "include" | "exclude" | null;
  transaction_currency: string | null;
  pending_transaction_id: string | null;
  plaid_primary_category: string | null;
  plaid_detailed_category: string | null;
  plaid_category_confidence: string | null;
};

// Only high-confidence provider taxonomy; descriptions never override transfer protection.
export function normalizePlaidCategory(
  primary?: string | null,
  detailed?: string | null,
  confidence?: string | null,
): BudgetCategory {
  if (!["HIGH", "VERY_HIGH"].includes(confidence ?? "")) return "needs_review";
  const p = primary ?? "",
    d = detailed ?? "";
  if (p.startsWith("TRANSFER")) return "transfer";
  if (p === "LOAN_PAYMENTS")
    return d.includes("CREDIT_CARD")
      ? "card_payment"
      : d.includes("MORTGAGE")
        ? "housing"
        : "debt_payment";
  if (p === "INCOME") return "income";
  if (p === "RENT_AND_UTILITIES")
    return d.includes("RENT") ? "housing" : "utilities";
  if (d.includes("INSURANCE")) return "insurance";
  if (d.includes("TAX")) return "tax";
  if (p === "FOOD_AND_DRINK")
    return d.includes("GROCER")
      ? "groceries"
      : d.includes("COFFEE")
        ? "coffee"
        : d.includes("BEER") || d.includes("BAR")
          ? "nightlife"
          : "dining";
  if (p === "GENERAL_MERCHANDISE") return "shopping";
  if (p === "ENTERTAINMENT") return "entertainment";
  // Health, transport, services and personal care can be obligations; require review.
  return "needs_review";
}
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const day = new Date(`${today}T12:00:00Z`).getUTCDay();
  const elapsed = (day + 6) % 7;
  const start = addDays(today, -elapsed);
  return {
    start,
    end: addDays(start, 7),
    previousStart: addDays(start, -7),
    today,
    daysElapsed: elapsed + 1,
    daysRemaining: 7 - elapsed,
  };
}
export function accountSources(accounts: readonly BudgetAccount[]) {
  const sources = new Map<
    string,
    "include" | "exclude" | "review" | "duplicate"
  >();
  const identities = new Set<string>();
  for (const account of [...accounts].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  )) {
    let source: "include" | "exclude" | "review" | "duplicate" =
      account.weekly_budget_source;
    if (source === "include" && account.persistent_account_id) {
      if (identities.has(account.persistent_account_id)) source = "duplicate";
      else identities.add(account.persistent_account_id);
    }
    sources.set(account.id, source);
  }
  return sources;
}
export function transactionDecision(
  t: BudgetTransaction,
  accounts: readonly BudgetAccount[],
  sources = accountSources(accounts),
  accountMap = new Map(accounts.map((a) => [a.id, a])),
) {
  const source = t.account_id ? sources.get(t.account_id) : undefined;
  const account = t.account_id ? accountMap.get(t.account_id) : undefined;
  const currency = t.transaction_currency ?? account?.currency;
  const category = t.category_override ?? t.normalized_category;
  const decision = (
    kind: "include" | "exclude" | "review" | "credit" | "currency",
    reason: string,
  ) => ({ kind, reason, category });
  if (currency !== "USD")
    return decision(
      "currency",
      "Currency is unknown or not USD; no conversion applied.",
    );
  if (source === "duplicate")
    return decision(
      "exclude",
      "Duplicate durable account identity; canonical source used.",
    );
  if (source === "exclude")
    return decision(
      "exclude",
      "Account explicitly excluded from weekly budget.",
    );
  if (source !== "include")
    return decision(
      "review",
      "Confirm one source per underlying account in Budget before including it.",
    );
  if (t.pending == null)
    return decision("review", "Pending or posted status is unknown.");
  if (
    t.amount == null ||
    (typeof t.amount === "string" && !t.amount.trim()) ||
    !Number.isFinite(Number(t.amount))
  )
    return decision("review", "Amount unavailable.");
  if (t.weekly_budget_override === "exclude")
    return decision("exclude", "User excluded this transaction.");
  const include =
    t.weekly_budget_override === "include" || discretionary.has(category);
  if (Number(t.amount) < 0) {
    if (
      include &&
      (t.weekly_budget_override === "include" || t.category_override != null)
    )
      return decision(
        "include",
        "User explicitly classified this credit as discretionary; offsets spending, capped at zero net.",
      );
    return decision(
      "credit",
      "Unmatched credit or refund; not counted as new spending or extra budget.",
    );
  }
  if (t.weekly_budget_override === "include")
    return decision("include", "User explicitly included this transaction.");
  if (category === "needs_review")
    return decision("review", "Unknown or ambiguous category requires review.");
  return decision(
    include ? "include" : "exclude",
    t.category_override
      ? "User category override takes precedence."
      : "High-confidence provider category determines inclusion.",
  );
}
export function weeklyMetrics(
  transactions: readonly BudgetTransaction[],
  accounts: readonly BudgetAccount[],
  limit: number | null,
  now = new Date(),
) {
  const period = weekPeriod(now);
  const postedLinks = new Set(
    transactions
      .filter((t) => t.pending === false && t.pending_transaction_id)
      .map((t) => `${t.account_id}:${t.pending_transaction_id}`),
  );
  const seen = new Set<string>();
  const sources = accountSources(accounts),
    accountMap = new Map(accounts.map((a) => [a.id, a]));
  let gross = 0,
    eligibleCredits = 0,
    pending = 0,
    previousGross = 0,
    previousCredits = 0;
  let excluded = 0,
    review = 0,
    reviewCount = 0,
    credits = 0,
    currencyCount = 0;
  const breakdown: Partial<Record<BudgetCategory, number>> = {};
  for (const t of transactions) {
    if (t.date < period.previousStart || t.date >= period.end) continue;
    if (
      t.pending &&
      t.plaid_transaction_id &&
      postedLinks.has(`${t.account_id}:${t.plaid_transaction_id}`)
    )
      continue;
    const identity = t.plaid_transaction_id
      ? `plaid:${t.plaid_transaction_id}`
      : `row:${t.id}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    const amount = Math.round(Number(t.amount) * 100);
    const current = t.date >= period.start;
    const d = transactionDecision(t, accounts, sources, accountMap);
    if (d.kind === "include" && Number.isFinite(amount)) {
      if (t.pending) {
        if (current && amount > 0) pending += amount;
      } else if (current) {
        if (amount >= 0) gross += amount;
        else eligibleCredits += -amount;
        breakdown[d.category] = (breakdown[d.category] ?? 0) + amount;
      } else {
        if (amount >= 0) previousGross += amount;
        else previousCredits += -amount;
      }
    } else if (current) {
      if (d.kind === "currency") currencyCount++;
      else if (d.kind === "review") {
        reviewCount++;
        if (Number.isFinite(amount) && amount > 0) review += amount;
      } else if (d.kind === "exclude" && Number.isFinite(amount) && amount > 0)
        excluded += amount;
      else if (d.kind === "credit" && Number.isFinite(amount))
        credits += Math.abs(amount);
    }
  }
  const posted = Math.max(0, gross - eligibleCredits) / 100;
  const previous = Math.max(0, previousGross - previousCredits) / 100;
  const remaining = limit == null ? null : (Math.round(limit * 100) - Math.round(posted * 100)) / 100;
  const provisional = accounts.length === 0 || reviewCount > 0 || currencyCount > 0 || [...sources.values()].some((s) => s === "review");
  return {
    ...period,
    limit,
    posted,
    pending: pending / 100,
    previous,
    change: posted - previous,
    remaining,
    provisional,
    safeRemaining: provisional ? null : remaining,
    conservativeRemaining: remaining == null ? null : (Math.round(remaining * 100) - review - pending) / 100,
    percentage:
      limit == null
        ? null
        : limit > 0
          ? (posted / limit) * 100
          : posted > 0
            ? 100
            : 0,
    overBudget: remaining == null ? null : Math.max(0, -remaining),
    averageDaily: posted / period.daysElapsed,
    suggestedDaily:
      remaining == null || provisional ? null : Math.max(0, remaining - pending / 100) / period.daysRemaining,
    excluded: excluded / 100,
    review: review / 100,
    reviewCount,
    unmatchedCredits: credits / 100,
    currencyCount,
    eligibleCredits: eligibleCredits / 100,
    breakdown: Object.fromEntries(
      Object.entries(breakdown).map(([key, cents]) => [key, cents / 100]),
    ),
  };
}
