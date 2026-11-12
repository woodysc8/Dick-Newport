import { createHash } from "node:crypto";
import { classifyTransaction } from "./transactionClassification";
import { categories } from "./discretionaryBudget";
import type { loadFinancialBudget } from "./financialBudgetData";

export const briefingTitle = "Richard-Newport / Perfi Daily Financial Briefing";
export const managedMarker =
  "PERFI PRIVATE FINANCIAL BRIEFING — MANAGED DOCUMENT";
export const safeDescription = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
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
  const fresh =
    !!sync?.last_success_at &&
    now.getTime() - Date.parse(sync.last_success_at) < 24 * 3600000;
  const accounts = data.snapshot.accounts.filter(
    (a) => a.weekly_budget_source === "include",
  );
  const identities = new Set<string>();
  let cash = 0,
    investment = 0,
    debt = 0,
    missing = 0;
  for (const a of accounts) {
    if (a.persistent_account_id && identities.has(a.persistent_account_id))
      continue;
    if (a.persistent_account_id) identities.add(a.persistent_account_id);
    if (
      a.currency !== "USD" ||
      a.current_balance == null ||
      !Number.isFinite(Number(a.current_balance))
    ) {
      missing++;
      continue;
    }
    const value = Number(a.current_balance);
    if (a.account_type === "credit" || a.account_type === "loan") debt += value;
    else if (a.account_type === "investment") investment += value;
    else if (a.account_type === "depository") cash += value;
    else missing++;
  }
  const recent = [...data.snapshot.transactions]
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    .slice(0, 10);
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
    `Last verified successful sync: ${sync?.last_success_at ? new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(sync.last_success_at)) : "Not recorded"}. ${fresh ? "Recorded within 24 hours." : "STALE/UNVERIFIED: totals may omit recent activity."}`,
    "ACCOUNT COVERAGE (USD only)",
    `Confirmed-source balances: cash ${money(cash)}, investments ${money(investment)}, debt ${money(debt)}. Net worth subtotal ${money(cash + investment - debt)}.`,
    `Coverage: ${accounts.length} confirmed source records; ${missing} balances unsupported/missing. Unconfirmed sources: ${data.snapshot.accounts.filter((a) => a.weekly_budget_source === "review").length}. Balances are observed snapshots, not guaranteed available cash. No FX conversion.`,
    "WEEKLY DISCRETIONARY BUDGET",
    `Monday–Sunday ${w.start} through ${w.end} (end exclusive). Limit ${money(w.limit)}; posted ${money(w.posted)}; pending projected ${money(w.pending)}.`,
    `Confirmed subtotal remaining ${money(w.remaining)}; ${w.provisional || !fresh ? "PROVISIONAL: not a safe-to-spend allowance." : "Coverage and review checks passed; provider freshness still applies."}`,
    `Needs review ${w.reviewCount} (${money(w.review)}); excluded ${money(w.excluded)}; unmatched credits ${money(w.unmatchedCredits)}; non-USD/unknown currency ${w.currencyCount}.`,
    `Conservative allowance after known review debits and pending ${money(w.conservativeRemaining)}; ${w.daysRemaining} days left. Suggested daily allowance ${w.provisional || !fresh ? "Unavailable pending review/freshness" : money(w.suggestedDaily)}.`,
    `Previous complete week ${money(w.previous)} versus current partial week ${money(w.posted)}. Difference ${money(w.change)}; unequal-duration comparison.`,
    "MONTH TO DATE",
    `${m.start} through ${m.end} (end exclusive). Posted spending ${money(m.posted)}; pending ${money(m.pending)}; needs review ${money(m.review)}.`,
    `Observed fixed obligations including rent ${money(m.groups.fixed ?? 0)}; essential-variable ${money(m.groups.essential ?? 0)}; discretionary ${money(m.groups.discretionary ?? 0)}.`,
    `Observed classified income ${money(m.income)}. Planned monthly income ${money(data.planning?.income ?? null)}; planned recurring obligations including configured rent ${money(data.planning?.recurring ?? null)}. Planning is an estimate, not an extra observed expense.`,
    `Cash inflows ${money(m.cashflow.inflow)}, outflows ${money(m.cashflow.outflow)}, net ${money(m.cashflow.net)}. Inflows include transfers/credits and are NOT verified income. Planned recurring obligations/income remain in Financial profile; unobserved rent or paychecks cannot be inferred.`,
    `Previous complete month spending ${money(m.previousCompleteMonth)}; current month is partial. ${m.provisional ? "Monthly totals provisional." : ""}`,
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
