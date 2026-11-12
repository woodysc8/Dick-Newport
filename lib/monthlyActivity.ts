import { classifyTransaction } from "./transactionClassification";
import type { BudgetAccount, BudgetTransaction } from "./discretionaryBudget";

export function calendarMonth(month: string) {
  if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) || Number(month.slice(0, 4)) > 9998)
    throw new Error("Invalid calendar month");
  const year = Number(month.slice(0, 4)), number = Number(month.slice(5));
  return { start: `${month}-01`, end: number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, "0")}-01` };
}

const manualMovements = new Set(["transfer", "card_payment", "investment", "savings", "debt_payment"]);
const verifiedMovementDetails = new Set([
  "TRANSFER_OUT_ACCOUNT_TRANSFER", "TRANSFER_IN_ACCOUNT_TRANSFER",
  "TRANSFER_OUT_INVESTMENT_AND_RETIREMENT_FUNDS", "TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS",
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
]);

function purpose(t: BudgetTransaction): "purchase" | "movement" | "unverified" {
  if (t.category_override != null) {
    if (manualMovements.has(t.category_override)) return "movement";
    return ["needs_review", "income"].includes(t.category_override) ? "unverified" : "purchase";
  }
  const modern = ["HIGH", "VERY_HIGH"].includes(t.plaid_category_confidence ?? "") &&
    !!t.plaid_primary_category && !!t.plaid_detailed_category &&
    t.plaid_detailed_category.startsWith(`${t.plaid_primary_category}_`);
  if (modern && verifiedMovementDetails.has(t.plaid_detailed_category!)) return "movement";
  const c = classifyTransaction(t);
  // Broad transfer labels, legacy paths, merchant guesses and Venmo are not
  // evidence that a debit was an internal movement rather than a purchase.
  return modern && c.confidence === "high" && !manualMovements.has(c.category) && c.category !== "income"
    ? "purchase" : "unverified";
}

const numericAmount = (value: BudgetTransaction["amount"]) =>
  value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);

export function summarizeMonthlyActivity(
  transactions: readonly BudgetTransaction[],
  accounts: readonly BudgetAccount[],
  month: string,
  selectedAccountId: string | null = null,
  postedReplacements: readonly Pick<BudgetTransaction, "account_id" | "pending_transaction_id">[] = [],
) {
  const period = calendarMonth(month);
  const current = transactions.filter((t) => t.date >= period.start && t.date < period.end);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const group = (id: string | null) => id == null ? "missing-account" :
    byId.get(id)?.persistent_account_id ? `durable:${byId.get(id)!.persistent_account_id}` : `account:${id}`;
  const activeIds = new Set(current.map((t) => t.account_id));
  const canonical = new Map<string, BudgetAccount>();
  for (const a of [...accounts].sort((a, b) =>
    Number(activeIds.has(b.id)) - Number(activeIds.has(a.id)) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))) {
    if (!canonical.has(group(a.id))) canonical.set(group(a.id), a);
  }
  const selectedGroup = selectedAccountId ? group(selectedAccountId) : null;
  const relevant = (id: string | null) => selectedGroup == null || group(id) === selectedGroup;
  const links = new Set([...current.filter((t) => t.pending === false), ...postedReplacements]
    .filter((t) => t.pending_transaction_id)
    .map((t) => `${group(t.account_id)}:${t.pending_transaction_id}`));
  const identities = new Set<string>();
  let omittedDuplicates = 0;
  const unique = [...current].sort((a, b) =>
    Number(b.pending === false) - Number(a.pending === false) || a.id.localeCompare(b.id)).filter((t) => {
    if (!relevant(t.account_id)) return false;
    const replaced = t.pending === true && t.plaid_transaction_id && links.has(`${group(t.account_id)}:${t.plaid_transaction_id}`);
    const identity = t.plaid_transaction_id ? `plaid:${t.plaid_transaction_id}` : `row:${t.id}`;
    if (replaced || identities.has(identity)) {
      omittedDuplicates++;
      return false;
    }
    identities.add(identity);
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  // Durable account identity groups connections, but does not prove that two
  // different provider transaction IDs describe the same purchase. Keep both
  // records and withhold combined money figures if their histories overlap.
  const sourceIds = new Map<string, Set<string | null>>();
  for (const t of unique) {
    const ids = sourceIds.get(group(t.account_id)) ?? new Set<string | null>();
    ids.add(t.account_id); sourceIds.set(group(t.account_id), ids);
  }
  const unresolvedRepeatedSources = [...sourceIds.values()].filter((ids) => ids.size > 1).length;
  const currencies = new Set<string>();
  let unknownCurrency = false, unknownAmountCount = 0, unknownStatusCount = 0;
  let posted = 0, confirmed = 0, unverified = 0, pending = 0, excludedMovements = 0;
  const rows = unique.map((t) => {
    const account = byId.get(t.account_id ?? "");
    const recordedCurrency = t.transaction_currency ?? account?.currency ?? null;
    const currency = recordedCurrency && /^[A-Z]{3}$/.test(recordedCurrency) ? recordedCurrency : null;
    if (currency) currencies.add(currency);
    else unknownCurrency = true;
    const amount = numericAmount(t.amount);
    const category = purpose(t);
    if (amount == null) unknownAmountCount++;
    if (t.pending == null) unknownStatusCount++;
    if (amount != null && amount > 0) {
      const cents = Math.round(amount * 100);
      if (category === "movement") excludedMovements += cents;
      else if (t.pending === true) pending += cents;
      else if (t.pending === false) {
        posted += cents;
        if (category === "purchase") confirmed += cents;
        else unverified += cents;
      }
    }
    return {
      id: t.id, date: t.date, merchant: t.merchant_name || t.name,
      amount, currency, pending: t.pending,
      account: account?.account_name || "Account unavailable",
      institution: account?.institution_name ?? null,
      purpose: amount != null && amount < 0 ? "incoming" as const : category,
    };
  });
  // Do not convert or combine currencies, or treat missing amounts as zero.
  if (rows.length === 0) for (const a of accounts.filter((a) => relevant(a.id))) {
    if (a.currency && /^[A-Z]{3}$/.test(a.currency)) currencies.add(a.currency);
    else unknownCurrency = true;
  }
  const currency = currencies.size === 1 && !unknownCurrency ? [...currencies][0] : null;
  const amountsKnown = currency != null && unknownAmountCount === 0 && unknownStatusCount === 0 && unresolvedRepeatedSources === 0;
  const asMoney = (cents: number) => amountsKnown ? cents / 100 : null;
  return {
    month, start: period.start, end: period.end, currency,
    totalTransactions: rows.length, postedPurchases: asMoney(posted),
    confirmedPurchases: asMoney(confirmed), unverifiedDebits: asMoney(unverified),
    pendingPurchases: asMoney(pending), excludedMovements: asMoney(excludedMovements),
    unknownAmountCount, unknownStatusCount, omittedDuplicates, unresolvedRepeatedSources,
    // No sync timestamp or source-history completeness is established by a read.
    provisional: true as const,
    repeatedSources: accounts.filter((a) => relevant(a.id)).length - [...canonical.values()].filter((a) => relevant(a.id)).length,
    accounts: [...canonical.values()].map((a) => ({ id: a.id, name: a.account_name, institution: a.institution_name })),
    selectedAccountId: selectedGroup ? canonical.get(selectedGroup)?.id ?? null : null,
    rows,
  };
}
