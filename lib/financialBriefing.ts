import { createHash } from "node:crypto";
import { classifyTransaction } from "./transactionClassification";
import { categories } from "./discretionaryBudget";
import type { loadFinancialBudget } from "./financialBudgetData";
import accounting from "./accounting";
import { getDashboardAccountClass, type DashboardAccount } from "./dashboard";
import { weekPeriod } from "./discretionaryBudget";

export const briefingTitle = "Richard-Newport / Perfi Daily Financial Briefing";
export const managedMarker =
  "PERFI PRIVATE FINANCIAL BRIEFING — MANAGED DOCUMENT";
export const safeDescription = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\d(?:[ -]*\d){7,}/g, "[redacted]")
    .replace(/\d{4,}/g, "[redacted]")
    .slice(0, 80);
const money = (n: number | null) =>
  n == null || !Number.isFinite(n)
    ? "Unavailable/unset"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(n);
export function briefingAmount(
  amount: number | string | null,
  currency: string | null,
) {
  if (currency !== "USD") return "Unsupported/unknown currency";
  if (
    amount == null ||
    (typeof amount === "string" && !amount.trim()) ||
    !Number.isFinite(Number(amount))
  )
    return "Amount unavailable";
  const value = Number(amount);
  return `${value < 0 ? "+" : "−"}${money(Math.abs(value))} ${value < 0 ? "credit" : "debit"}`;
}
export function generateBriefing(
  data: Awaited<ReturnType<typeof loadFinancialBudget>>,
  now = new Date(),
) {
  const w = data.weekly,
    m = data.monthly;
  const sync = data.snapshot.jobs.find((j) => j.kind === "sync");
  const syncTime = sync?.last_success_at ? Date.parse(sync.last_success_at) : NaN;
  const fresh =
    Number.isFinite(syncTime) && syncTime <= now.getTime() &&
    now.getTime() - syncTime < 24 * 3600000;
  // Budget-source inclusion describes spending coverage, not asset ownership.
  const identities = new Set<string>();
  const accounts = [...data.snapshot.accounts].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).filter((a) => {
    const identity = a.persistent_account_id ?? a.id;
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  });
  const recorded = accounts.map((a): DashboardAccount => ({
    ...a, account_type: a.account_type ?? null, account_subtype: null,
    mask: null, current_balance: a.current_balance ?? null, available_balance: null,
    ...data.briefingDetails?.accounts?.find((detail) => detail.id === a.id),
  }));
  const position = accounting.summarizeAccounts(recorded);
  const positionMoney = (value: number | null) => position.configured && position.currency === "USD" && !position.mixedCurrency ? money(value) : "Unavailable (currency/coverage)";
  const profile = data.snapshot.planning_profile;
  const today = weekPeriod(now).today;
  const nextPayday = profile?.paychecks?.paydays?.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= today).sort()[0];
  const holdings = data.briefingDetails?.holdings;
  const recent = [...data.snapshot.transactions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 10);
  const review = [...data.snapshot.transactions]
    .filter((t) => !t.category_override && (t.normalized_category === "needs_review" || classifyTransaction(t).category === "needs_review"))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 15);
  const anomalies = data.snapshot.transactions
    .filter(
      (t) =>
        t.date >= w.start &&
        t.transaction_currency === "USD" &&
        Number(t.amount) >= 200 &&
        t.pending === false,
    )
    .slice(0, 10);
  const lines = [
    managedMarker,
    briefingTitle,
    `Generated: ${new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "full", timeStyle: "short" }).format(now)} America/New_York`,
    `Last verified successful sync: ${Number.isFinite(syncTime) ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(syncTime)) : "Not recorded or invalid"}. ${fresh ? "Recorded within 24 hours." : "STALE/UNVERIFIED: totals may omit recent activity."}`,
    "ACCOUNT COVERAGE (USD only)",
    `Recorded connected balances: checking/savings liquidity ${positionMoney(position.cash)}, investments ${positionMoney(position.investments)}, debt ${positionMoney(position.credit)}. Connected net worth ${positionMoney(position.netWorth)}. Manual assets and debts are not included in these connected totals.`,
    `Coverage: ${accounts.length} records after durable-identity deduplication; ${data.snapshot.accounts.length - accounts.length} duplicate records omitted. Missing identities may conceal repeated connections. Unconfirmed budget sources: ${data.snapshot.accounts.filter((a) => a.weekly_budget_source === "review").length}. Account detail read ${data.briefingDetails?.accounts ? "available" : "unavailable"}. Balances are recorded snapshots, not guaranteed available cash. Account and investment freshness are unverified independently of transaction sync. No FX conversion.`,
    "WEEKLY DISCRETIONARY BUDGET",
    `Monday–Sunday ${w.start} through ${w.end} (end exclusive). Limit ${money(w.limit)}; posted ${money(w.posted)}; pending projected ${money(w.pending)}.`,
    `Confirmed subtotal remaining ${money(w.remaining)}; ${w.provisional || !fresh ? "PROVISIONAL: not a safe-to-spend allowance." : "Coverage and review checks passed; provider freshness still applies."}`,
    `Monthly discretionary budget target equivalent ${money(w.monthlyTargetEquivalent)} (52 weeks / 12 months); not actual spending. Groceries are weekly included; rent, transfers and debt/card payments are excluded by default. Do not combine this target with recurring obligations until category overlap is reviewed.`,
    `Needs review ${w.reviewCount} (${money(w.review)}); excluded ${money(w.excluded)}; unmatched credits ${money(w.unmatchedCredits)}; non-USD/unknown currency ${w.currencyCount}.`,
    `Conservative allowance after known review debits and pending ${money(w.conservativeRemaining)}; ${w.daysRemaining} days left. Suggested daily allowance ${w.provisional || !fresh ? "Unavailable pending review/freshness" : money(w.suggestedDaily)}.`,
    `Previous complete week ${money(w.previous)} versus current partial week ${money(w.posted)}. Difference ${money(w.change)}; unequal-duration comparison.`,
    "MONTH TO DATE",
    `${m.start} through ${m.end} (end exclusive). Posted spending ${money(m.posted)}; pending ${money(m.pending)}; needs review ${money(m.review)}.`,
    `Observed fixed obligations including rent ${money(m.groups.fixed ?? 0)}; essential-variable ${money(m.groups.essential ?? 0)}; discretionary ${money(m.groups.discretionary ?? 0)}.`,
    `Observed classified income ${money(m.income)}. Planned monthly income ${money(data.planning?.income ?? null)}; planned recurring obligations including configured rent ${money(data.planning?.recurring ?? null)}. Planning is an estimate, not an extra observed expense.`,
    `Cash inflows ${money(m.cashflow.inflow)}, outflows ${money(m.cashflow.outflow)}, net ${money(m.cashflow.net)}. Inflows include transfers/credits and are NOT verified income. Planned recurring obligations/income remain in Financial profile; unobserved rent or paychecks cannot be inferred.`,
    `Previous complete month spending ${money(m.previousCompleteMonth)}; current month is partial. ${m.provisional ? "Monthly totals provisional." : ""}`,
    `Recorded transfers ${money(m.transfers)} and card payments ${money(m.cardPayments)} are movements, not additional purchases. Category totals (posted classified activity): ${Object.entries(m.breakdown).map(([key, value]) => `${categories[key as keyof typeof categories]} ${money(value)}`).join("; ") || "None classified"}.`,
    "UPCOMING CASH FLOW (configured plans, not bank-verified promises)",
    `Next verified paycheck date: unavailable. Next configured payday: ${nextPayday ?? "Not configured"}; configured take-home paycheck amount ${profile?.currency === "USD" ? money(profile.paychecks?.netAmount ?? null) : "Unavailable"}.`,
    ...(profile?.recurringExpenses?.slice(0, 20).map((bill) => `${safeDescription(bill.name)} | configured ${profile.currency === "USD" ? money(bill.amount ?? null) : "Unsupported/unknown currency"} | ${safeDescription(bill.frequency ?? "frequency unavailable")} | due date as recorded: ${/^\d{4}-\d{2}-\d{2}$/.test(bill.dueDate ?? "") ? bill.dueDate : "unavailable"} | funding account unavailable`) ?? ["Recurring bill schedule unavailable."]),
    "CREDIT CARDS (recorded balances already include provider-posted activity)",
    ...recorded.filter((a) => getDashboardAccountClass(a) === "credit").map((a, index) => `Card ${index + 1} | recorded balance ${a.currency === "USD" ? money(a.current_balance == null || String(a.current_balance).trim() === "" ? null : Number(a.current_balance)) : "Unsupported/unknown currency"} | available credit ${a.currency === "USD" ? money(a.available_balance == null || String(a.available_balance).trim() === "" ? null : Number(a.available_balance)) : "Unsupported/unknown currency"}. Due date, statement balance, minimum payment and APR unavailable from connected records. No transaction review totals added to this balance.`),
    "Manual debt terms remain separate; matching to connected cards is unverified. No card records means coverage unavailable, not zero debt.",
    "INVESTMENTS",
    ...recorded.filter((a) => ["investment", "retirement"].includes(getDashboardAccountClass(a))).map((a, index) => `Investment account ${index + 1} | recorded balance ${a.currency === "USD" ? money(a.current_balance == null || String(a.current_balance).trim() === "" ? null : Number(a.current_balance)) : "Unsupported/unknown currency"}`),
    holdings == null ? "Individual holdings query unavailable." : holdings.length === 0 ? "Individual holdings are not yet available; this is not a zero-value portfolio." : `Available holdings: ${holdings.length}; list limited to 50 below, allocation coverage unverified.`,
    ...(holdings ?? []).slice(0, 50).map((h) => `${safeDescription(h.security_name ?? "Unnamed security")} | ticker ${safeDescription(h.ticker_symbol ?? "unavailable")} | value ${(h.currency ?? h.iso_currency_code) === "USD" ? money(h.institution_value == null || String(h.institution_value).trim() === "" ? null : Number(h.institution_value)) : "Unsupported/unknown currency"} | cost basis ${(h.currency ?? h.iso_currency_code) === "USD" ? money(h.cost_basis == null || String(h.cost_basis).trim() === "" ? null : Number(h.cost_basis)) : "Unsupported/unknown currency"}`),
    "Asset-class allocation unavailable: security type coverage is not recorded here. Verified Roth IRA contributions unavailable; planned transfers are not contribution history. Tax limits are not inferred.",
    "UNCLASSIFIED TRANSACTION REVIEW (up to 15 within snapshot date coverage)",
    ...review.map((t) => {
      const suggestion = classifyTransaction(t);
      const index = accounts.findIndex((a) => a.id === t.account_id);
      return `${t.date} | ${safeDescription(t.merchant_name || t.name)} | ${briefingAmount(t.amount, t.transaction_currency ?? accounts[index]?.currency ?? null)} | ${t.pending == null ? "status unknown" : t.pending ? "pending" : "posted"} | ${index < 0 ? "Account unavailable" : `Account ${index + 1}`} | suggestion: ${suggestion.confidence === "high" ? categories[suggestion.category] : "unavailable; review required"}`;
    }),
    "RECENT TRANSACTIONS (at most 10; not an exhaustive ledger)",
    ...recent.map(
      (t) =>
        `${t.date} | ${safeDescription(t.merchant_name || t.name)} | ${briefingAmount(t.amount, t.transaction_currency)} | ${t.pending == null ? "status unknown" : t.pending ? "pending" : "posted"} | ${categories[classifyTransaction(t).category]} (${classifyTransaction(t).source})`,
    ),
    "LARGE PURCHASE REVIEW (transparent threshold: posted USD debits >= $200 this week; not fraud detection)",
    ...anomalies.map(
      (t) =>
        `${t.date} | ${safeDescription(t.merchant_name || t.name)} | ${money(Number(t.amount))}`,
    ),
    "REVIEW AND LIMITATIONS",
    "Unknown classifications are omitted from confirmed spending, never assumed to be zero. Pending replacements and durable duplicate sources are suppressed in budget totals. Unmatched refunds cannot create extra budget. Missing accounts, stale balances and unsupported currencies make coverage incomplete. No account numbers, credentials or provider tokens are exported.",
  ];
  const text = `${lines.join("\n\n")}\n`;
  if (text.length > 30000) throw new Error("Briefing size limit exceeded");
  return {
    text,
    hash: createHash("sha256").update(text).digest("hex"),
    generatedAt: now.toISOString(),
    stale: !fresh,
  };
}
