import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadConnectedPosition } from "./connectedPosition";
import { loadMonthlyActivity } from "./transactionData";
import { normalizeFinancialProfile } from "./financialProfileNormalization";
import { calculateFinancialPlanning } from "./financialPlanning";
import { weekPeriod } from "./discretionaryBudget";

export type ReportSection = { title: string; lines: string[] };
export type FinancialReport = {
  version: 1;
  generatedAt: string;
  month: string;
  currency: string | null;
  netWorth: number | null;
  coverageKey: string | null;
  previousGeneratedAt: string | null;
  netWorthChange: number | null;
  sections: ReportSection[];
};

// Only display labels cross the report boundary. Provider IDs and raw rows never do.
export function reportLabel(value: unknown, fallback = "Unavailable") {
  return typeof value === "string" && value.trim()
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\d{4,}/g, "[redacted]").slice(0, 140)
    : fallback;
}
export function reportNumber(value: unknown): number | null {
  return value == null || value === "" || !["number", "string"].includes(typeof value) || !Number.isFinite(Number(value)) ? null : Number(value);
}
export function reportMoney(value: unknown, currency: string | null | undefined) {
  const number = reportNumber(value);
  return number == null || !currency || !/^[A-Z]{3}$/.test(currency) ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(number);
}
const timestamp = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : "Unavailable";

export function compareReport(current: Pick<FinancialReport, "currency" | "netWorth" | "coverageKey">, previous: FinancialReport | null) {
  return previous && current.currency && current.currency === previous.currency && current.coverageKey && current.coverageKey === previous.coverageKey && current.netWorth != null && previous.netWorth != null
    ? Math.round((current.netWorth - previous.netWorth) * 100) / 100 : null;
}

export async function generateFinancialReport(client: SupabaseClient, owner: string, previous: FinancialReport | null = null, now = new Date(), selectedMonth?: string): Promise<FinancialReport> {
  const month = selectedMonth ?? weekPeriod(now).today.slice(0, 7);
  const results = await Promise.allSettled([
    loadConnectedPosition(client, owner),
    loadMonthlyActivity(client, owner, new URLSearchParams({ month }), now),
    client.from("investment_holdings").select("plaid_account_id, security_name, ticker_symbol, quantity, institution_value, institution_price, cost_basis, currency, iso_currency_code, updated_at", { count: "exact" }).eq("user_id", owner).order("id").limit(501),
    client.from("profiles").select("financial_profile").eq("id", owner).maybeSingle(),
    client.from("transactions").select("updated_at").eq("user_id", owner).order("updated_at", { ascending: false }).limit(1),
  ]);
  const position = results[0].status === "fulfilled" ? results[0].value : null;
  const activity = results[1].status === "fulfilled" ? results[1].value : null;
  const holdingsResult = results[2].status === "fulfilled" ? results[2].value : null;
  const holdings = holdingsResult && !holdingsResult.error && holdingsResult.count != null && holdingsResult.count <= 500 && holdingsResult.data?.length === holdingsResult.count ? holdingsResult.data : null;
  const profileResult = results[3].status === "fulfilled" ? results[3].value : null;
  const profile = profileResult && !profileResult.error && profileResult.data?.financial_profile ? normalizeFinancialProfile(profileResult.data.financial_profile) : null;
  const updatedResult = results[4].status === "fulfilled" ? results[4].value : null;
  const currency = position?.summary.currency ?? null;
  const netWorth = position?.summary.netWorth ?? null;
  // Used only for compatibility checks, never rendered or exported. Hashes do not
  // reveal account/provider identifiers or permit merging different owners.
  const coverageKey = position && netWorth != null ? createHash("sha256").update(JSON.stringify([owner, position.accounts.map((a) => [a.id, a.account_type, a.currency]).sort()])).digest("hex") : null;
  const netWorthChange = compareReport({ currency, netWorth, coverageKey }, previous);
  const sections: ReportSection[] = [
    { title: "Financial position", lines: [
      `Connected net worth: ${reportMoney(netWorth, currency)}`,
      `Cash: ${reportMoney(position?.summary.cash, currency)}`,
      `Investments: ${reportMoney(position?.summary.investments, currency)}`,
      `Crypto: ${reportMoney(position?.summary.crypto, currency)}`,
      `Liabilities (credit cards and loans): ${reportMoney(position?.summary.credit, currency)}`,
      "Recorded connected assets minus liabilities. Holdings are already included in account balances; manual assets and debt are not added. This is not a complete household valuation.",
      position ? `${position.accounts.length} connected accounts; ${position.duplicatesOmitted} duplicate balance records omitted. ${position.unknownTypes ? "Unknown account types prevent a net-worth total." : ""}` : "Account coverage unavailable; no partial net-worth total is shown.",
    ] },
    { title: "Changes since the previous saved report", lines: previous ? [
      `Previous report generated: ${previous.generatedAt}`,
      netWorthChange == null ? "Net-worth change unavailable: compatible complete balance coverage and currency are required." : `Recorded net-worth change: ${reportMoney(netWorthChange, currency)}. This is a change between saved observations, not an investment return or proof of new bank data.`,
      "Monthly spending changes are not compared because report dates may cover different observation periods and transaction history remains provisional.",
    ] : ["No previous saved report is available. Historical changes are unavailable."] },
    { title: "Connected accounts and source freshness", lines: position?.accounts.length ? position.accounts.map((a) => `${reportLabel(a.account_name, "Connected account")} | ${reportLabel(a.institution_name, "Institution unverified")} | ${reportLabel(a.account_type)} | Balance ${reportMoney(a.current_balance, a.currency)} | Record updated ${timestamp(a.updated_at)}`) : ["Connected account data unavailable or no accounts connected."] },
    { title: "Investment holdings", lines: holdings == null ? ["Holdings could not be read completely. Missing data is not a zero-value portfolio."] : !holdings.length ? ["Individual holdings are not yet available. See connected investment balances above."] : holdings.map((h) => {
      const c = h.currency ?? h.iso_currency_code;
      const account = position?.accounts.find((a) => a.plaid_account_id === h.plaid_account_id);
      return `${reportLabel(h.security_name, "Unnamed security")} | ${reportLabel(h.ticker_symbol)} | ${reportLabel(account?.account_name, "Account unavailable")} | Quantity ${reportNumber(h.quantity) ?? "Unavailable"} | Market value ${reportMoney(h.institution_value, c)} | Price ${reportMoney(h.institution_price, c)} | Cost basis ${reportMoney(h.cost_basis, c)} | Record updated ${timestamp(h.updated_at)}`;
    }) },
    { title: "Purchase history", lines: ["Purchase history unavailable", "Actual trade and tax-lot acquisition records are not stored. Record update times and account creation dates are not purchase dates. Returns and Roth contribution totals are unavailable."] },
    { title: `Monthly spending: ${month}`, lines: activity ? [
      `Posted purchases including unverified debits (provisional): ${reportMoney(activity.postedPurchases, activity.currency)}`,
      `Confirmed posted purchases: ${reportMoney(activity.confirmedPurchases, activity.currency)}`,
      `Unverified posted debits: ${reportMoney(activity.unverifiedDebits, activity.currency)}`,
      `Pending purchase exposure (not posted spending): ${reportMoney(activity.pendingPurchases, activity.currency)}`,
      `Excluded posted movements: ${reportMoney(activity.excludedMovements, activity.currency)}`,
      ...Object.entries(activity.movementBreakdown).map(([key, value]) => `${key}: ${reportMoney(value, activity.currency)}`),
      `Transactions: ${activity.totalTransactions}. Duplicates/replaced pending records omitted: ${activity.omittedDuplicates}. Unresolved repeated sources: ${activity.unresolvedRepeatedSources}. Unknown amounts: ${activity.unknownAmountCount}; unknown statuses: ${activity.unknownStatusCount}.`,
      "Calendar-month saved records; history completeness and bank-sync freshness are unverified. Incoming credits (including income, refunds and incoming transfers) are not purchases. Uncertain Venmo and other debits remain provisional. Unavailable totals are never replaced by zero.",
    ] : ["Monthly transaction coverage unavailable; spending totals are unavailable."] },
    { title: "Recent monthly transactions (up to 15)", lines: activity ? activity.rows.slice(0, 15).map((t) => `${t.date} | ${reportLabel(t.merchant)} | ${reportMoney(t.amount, t.currency)} | ${reportLabel(t.account, "Connected account")} | ${t.pending === true ? "Pending" : t.pending === false ? "Posted" : "Status unavailable"} | ${t.purpose}`) : ["Transaction detail unavailable."] },
    { title: "Configured income and obligations", lines: profile ? [
      `Configured monthly take-home estimate: ${reportMoney(calculateFinancialPlanning(profile).income.estimatedMonthlyTakeHomeIncome, profile.currency)}. This is a configured estimate, not verified received income; eligible configured sources may be incomplete.`,
      "Received income is not inferred from all incoming credits. Next verified paycheck date unavailable.",
      ...(profile.incomeSources ?? []).slice(0, 30).map((i) => `${reportLabel(i.name, "Income source")} | ${reportMoney(i.amount, profile.currency)} | ${reportLabel(i.frequency)} | ${reportLabel(i.basis)} | Configured, unverified`),
      ...(profile.recurringExpenses ?? []).slice(0, 30).map((b) => `${reportLabel(b.name, "Obligation")} | ${reportMoney(b.amount, profile.currency)} | ${reportLabel(b.frequency)} | Configured due date ${b.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(b.dueDate) ? b.dueDate : "Unavailable"} | Funding account unavailable`),
      ...(profile.debts ?? []).slice(0, 30).map((d) => `${reportLabel(d.name, "Debt")} | Manual balance ${reportMoney(d.balance, profile.currency)} | Minimum ${reportMoney(d.minimumPayment, profile.currency)} | APR ${reportNumber(d.annualInterestRatePercent) ?? "Unavailable"}${d.annualInterestRatePercent == null ? "" : "%"}`),
      "Configured debts may overlap connected liabilities and are not added to them. Manual obligations are not combined with spending totals. Configured sections show at most 30 entries each. Card available credit, statement balance and due date are unavailable unless separately verified.",
    ] : ["Financial profile information unavailable or not configured. Income, bill schedules and manual debt terms are unavailable."] },
    { title: "Data quality and interpretation", lines: [
      `Report generated: ${now.toISOString()}. Generating this report reads saved records only and does not sync financial sources.`,
      `Most recent transaction record update (all history): ${updatedResult && !updatedResult.error ? timestamp(updatedResult.data?.[0]?.updated_at) : "Unavailable"}. This does not establish complete bank synchronization.`,
      "Account and holding record timestamps are shown individually. Their bank observation times may differ; freshness is unverified. Financial profile update time unavailable. Missing information is not zero.",
      "No currency conversion, fabricated holdings, acquisition dates, performance calculations or tax contribution assumptions are used. Historical reports preserve the facts and uncertainty known at generation time.",
    ] },
  ];
  return { version: 1, generatedAt: now.toISOString(), month, currency, netWorth, coverageKey, previousGeneratedAt: previous?.generatedAt ?? null, netWorthChange, sections };
}
