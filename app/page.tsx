import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { signOut } from "./auth/actions";
import {
  DashboardAccount,
  InvestmentHolding,
  InvestmentSnapshot,
  RecentTransaction,
} from "../lib/dashboard";
import { buildDashboardViewModel, PortfolioPosition } from "../lib/dashboardViewModel";
import { getSpendingPeriod } from "../lib/financialPlan";
import { LEGACY_EXAMPLE_FINANCIAL_PROFILE, STARTER_FINANCIAL_PROFILE, type FinancialProfile } from "../lib/financialProfileDefaults";
import { normalizeFinancialProfile } from "../lib/financialProfileNormalization";
import { createSupabaseServerClient, ensureOwnProfile } from "../lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function number(value: number | string | null | undefined): number | null {
  const parsed = Number(value);
  return value == null || value === "" || !Number.isFinite(parsed) ? null : parsed;
}

function isFinancialProfile(value: unknown): value is FinancialProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  if (typeof profile.label !== "string" || typeof profile.currency !== "string") return false;
  if (profile.paychecks != null) {
    if (typeof profile.paychecks !== "object" || Array.isArray(profile.paychecks)) return false;
    const paychecks = profile.paychecks as Record<string, unknown>;
    if (paychecks.paydays != null && (!Array.isArray(paychecks.paydays) || !paychecks.paydays.every((day) => typeof day === "string"))) return false;
    for (const key of ["netAmount", "rothContribution", "billsAllocation", "weeklySpendingAllocation", "cushion"]) {
      if (paychecks[key] != null && (typeof paychecks[key] !== "number" || !Number.isFinite(paychecks[key]))) return false;
    }
  }
  if (profile.weeklySpending != null) {
    if (typeof profile.weeklySpending !== "object" || Array.isArray(profile.weeklySpending)) return false;
    const weekly = profile.weeklySpending as Record<string, unknown>;
    for (const key of ["weeklyTarget", "dailyTarget"]) {
      if (weekly[key] != null && (typeof weekly[key] !== "number" || !Number.isFinite(weekly[key]))) return false;
    }
  }
  if (profile.roth != null) {
    if (typeof profile.roth !== "object" || Array.isArray(profile.roth)) return false;
    const roth = profile.roth as Record<string, unknown>;
    if (typeof roth.destination !== "string" || typeof roth.totalRemaining !== "number" || !Number.isFinite(roth.totalRemaining) || !Array.isArray(roth.contributions)) return false;
    if (!roth.contributions.every((item) => !!item && typeof item === "object" && typeof (item as Record<string, unknown>).date === "string" && typeof (item as Record<string, unknown>).amount === "number" && Number.isFinite((item as Record<string, unknown>).amount))) return false;
  }
  if (profile.budget != null) {
    if (typeof profile.budget !== "object" || Array.isArray(profile.budget)) return false;
    const budget = profile.budget as Record<string, unknown>;
    if (budget.monthlyIncome != null && (typeof budget.monthlyIncome !== "number" || !Number.isFinite(budget.monthlyIncome))) return false;
    if (budget.monthlySpendingTarget != null && (typeof budget.monthlySpendingTarget !== "number" || !Number.isFinite(budget.monthlySpendingTarget))) return false;
    if (budget.expenses != null && (!Array.isArray(budget.expenses) || !budget.expenses.every((expense) => !!expense && typeof expense === "object" && typeof (expense as Record<string, unknown>).name === "string" && typeof (expense as Record<string, unknown>).category === "string" && typeof (expense as Record<string, unknown>).amount === "number" && Number.isFinite((expense as Record<string, unknown>).amount)))) return false;
  }
  return true;
}

function money(value: number | string | null | undefined, currency = "USD"): string {
  const amount = number(value);
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "USD";
  return amount == null
    ? "Unavailable"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: safeCurrency, maximumFractionDigits: 0 }).format(amount);
}

function signedMoney(value: number | null, currency = "USD"): string {
  if (value == null) return "Unavailable";
  return `${value >= 0 ? "+" : "-"}${money(Math.abs(value), currency)}`;
}

function percent(value: number | null | undefined): string {
  return value == null ? "Unavailable" : `${value.toFixed(1)}%`;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function accountName(account: DashboardAccount): string {
  return `${account.institution_name ?? "Unknown institution"} · ${account.account_name ?? "Unnamed account"}${account.mask ? ` ••••${account.mask}` : ""}`;
}

function accountCurrency(account: DashboardAccount | undefined): string | null {
  return account?.currency && /^[A-Z]{3}$/.test(account.currency) ? account.currency : null;
}

function transactionCategory(transaction: RecentTransaction): string {
  return Array.isArray(transaction.category) ? transaction.category.join(" > ") : transaction.category ?? "Uncategorized";
}

function propertyTypeLabel(type: string): string {
  return ({
    "primary-residence": "Primary residence",
    rental: "Rental property",
    "vacation-secondary-home": "Vacation / secondary home",
    land: "Land",
    other: "Other",
  } as Record<string, string>)[type] ?? type;
}

function debtTypeLabel(type: string | undefined): string {
  return type ? type.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Type not entered";
}

function planningDetail(status: "complete" | "partial" | "unavailable", excludedCount: number): string {
  if (status === "complete") return "Complete from entered profile data";
  if (status === "partial") return `Partial known subtotal · ${excludedCount} item(s) excluded`;
  return "Unavailable until required inputs are entered";
}

function SectionHeader({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-ink)]">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--text)]">{title}</h2>
      {detail && <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{detail}</p>}
    </div>
  );
}

function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-[var(--border)] bg-white p-5 ${className}`}>{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--text-muted)]">{children}</div>;
}

function Metric({ label, value, detail, positive = false }: { label: string; value: string; detail?: string; positive?: boolean }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${positive ? "text-[var(--up)]" : "text-[var(--text)]"}`}>{value}</p>
      {detail && <p className="mt-1 text-xs text-[var(--text-muted)]">{detail}</p>}
    </div>
  );
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={`h-2 overflow-hidden rounded-full bg-[var(--surface)] ${className}`}>
      <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  );
}

function PositionCard({ label, description, position, accent = false, children }: { label: string; description: string; position: PortfolioPosition; accent?: boolean; children?: ReactNode }) {
  const aggregate = (value: number | null) => position.mixedCurrency || !position.currency ? "Unavailable" : money(value, position.currency);
  return (
    <Panel className={accent ? "border-[var(--accent)]" : ""}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--text)]">{label}</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>
        </div>
        <span className="text-xs font-medium text-[var(--text-muted)]">{position.accounts.length} account{position.accounts.length === 1 ? "" : "s"}</span>
      </div>
      <p className="mt-7 text-xs text-[var(--text-muted)]">Total value</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-[var(--text)]">{aggregate(position.currentValue)}</p>
      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-4">
        <Metric label="Invested" value={aggregate(position.investedValue)} />
        <Metric label="Cash" value={aggregate(position.cashValue)} />
      </div>
      <div className="mt-5 flex items-center justify-between text-sm">
        <span className="text-[var(--text-muted)]">Gains / losses</span>
        <span className={position.totalGain == null ? "text-[var(--text-muted)]" : position.totalGain >= 0 ? "font-semibold text-[var(--up)]" : "font-semibold text-[var(--down)]"}>
          {position.mixedCurrency || !position.currency ? "Unavailable" : signedMoney(position.totalGain, position.currency)} {position.totalGainPercent == null ? "" : `(${percent(position.totalGainPercent)})`}
        </span>
      </div>
      {children}
    </Panel>
  );
}

function PortfolioTable({ title, position }: { title: string; position: PortfolioPosition }) {
  const aggregate = (value: number | null) => position.mixedCurrency || !position.currency ? "Unavailable" : money(value, position.currency);
  return (
    <Panel>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
          <p className="mt-1 text-sm text-[var(--text-muted)]">{position.holdings.length} holding{position.holdings.length === 1 ? "" : "s"} · {aggregate(position.investedValue)} invested</p>
        </div>
        <p className="text-sm font-semibold text-[var(--text)]">{aggregate(position.currentValue)}</p>
      </div>
      {position.holdings.length === 0 ? (
        <div className="mt-5"><Empty>No holdings are available for this purpose.</Empty></div>
      ) : (
        <div className="mt-5 divide-y divide-[var(--border)]">
          {position.holdings.map((holding) => (
            <div key={holding.id} className="grid gap-2 py-4 first:pt-0 sm:grid-cols-[1fr_auto_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate font-medium text-[var(--text)]">{holding.security_name ?? "Unknown security"}</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{holding.ticker_symbol ?? "Ticker unavailable"} · {holding.quantity == null ? "Shares unavailable" : `${holding.quantity} shares`}</p>
              </div>
              <div className="sm:text-right"><p className="text-xs text-[var(--text-muted)]">Value</p><p className="font-semibold text-[var(--text)]">{holding.currency ?? holding.iso_currency_code ? money(holding.institution_value, holding.currency ?? holding.iso_currency_code!) : "Unknown currency"}</p></div>
              <div className="sm:text-right"><p className="text-xs text-[var(--text-muted)]">Allocation</p><p className="font-semibold text-[var(--text)]">{percent(holding.allocationPercent)}</p></div>
              <div className="sm:col-span-3 sm:flex sm:items-center sm:gap-3"><ProgressBar value={holding.allocationPercent ?? 0} className="flex-1" /><span className={holding.gain == null ? "text-xs text-[var(--text-muted)]" : holding.gain >= 0 ? "text-xs text-[var(--up)]" : "text-xs text-[var(--down)]"}>{holding.currency ?? holding.iso_currency_code ? signedMoney(holding.gain, holding.currency ?? holding.iso_currency_code!) : "Unknown currency"}</span></div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function PortfolioGrowthChart({ observations, currency }: { observations: { date: string; value: number }[]; currency: string }) {
  if (observations.length < 2) {
    return <Empty>Portfolio history will appear as more securities-only snapshots are recorded.</Empty>;
  }

  const width = 720;
  const height = 240;
  const padding = { top: 18, right: 18, bottom: 34, left: 58 };
  const values = observations.map((observation) => observation.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const x = (index: number) => padding.left + (index / (observations.length - 1)) * (width - padding.left - padding.right);
  const y = (value: number) => padding.top + (1 - (value - minimum) / range) * (height - padding.top - padding.bottom);
  const points = observations.map((observation, index) => `${x(index)},${y(observation.value)}`).join(" ");
  const first = observations[0];
  const last = observations[observations.length - 1];

  return (
    <div className="overflow-x-auto">
      <svg aria-label="Portfolio value over time" className="min-w-[620px]" viewBox={`0 0 ${width} ${height}`} role="img">
        <line x1={padding.left} x2={width - padding.right} y1={height - padding.bottom} y2={height - padding.bottom} stroke="var(--border)" />
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={height - padding.bottom} stroke="var(--border)" />
        <polyline fill="none" points={points} stroke="var(--accent)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {observations.map((observation, index) => <circle key={`${observation.date}-${index}`} cx={x(index)} cy={y(observation.value)} fill="var(--bg)" r="4" stroke="var(--accent)" strokeWidth="2" />)}
        <text fill="var(--text-muted)" fontSize="11" x="4" y={padding.top + 4}>{money(maximum, currency)}</text>
        <text fill="var(--text-muted)" fontSize="11" x="4" y={height - padding.bottom}>{money(minimum, currency)}</text>
        <text fill="var(--text-muted)" fontSize="11" textAnchor="start" x={padding.left} y={height - 8}>{first.date}</text>
        <text fill="var(--text-muted)" fontSize="11" textAnchor="end" x={width - padding.right} y={height - 8}>{last.date}</text>
      </svg>
    </div>
  );
}

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login");
  const userId = authData.user.id;
  await ensureOwnProfile(supabase, userId);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  const historyStart = new Date(now.getFullYear(), now.getMonth() - 5, 1).toISOString().slice(0, 10);
  const spendingPeriod = getSpendingPeriod(now);
  const transactionSelect = "id, date, name, merchant_name, amount, category, pending, plaid_transaction_id, account_id";
  const [profileResult, accountsResult, monthResult, historyResult, weeklyResult, recentResult, holdingsResult, snapshotsResult] = await Promise.all([
    supabase.from("profiles").select("financial_profile").eq("id", userId).maybeSingle(),
    supabase.from("accounts").select("id, institution_name, account_name, mask, account_type, account_subtype, current_balance, available_balance, currency, plaid_account_id, plaid_item_id").eq("user_id", userId).order("created_at", { ascending: false }),
    supabase.from("transactions").select(transactionSelect).eq("user_id", userId).gte("date", monthStart).lte("date", monthEnd).order("date", { ascending: false }),
    supabase.from("transactions").select(transactionSelect).eq("user_id", userId).gte("date", historyStart).lte("date", monthEnd).order("date", { ascending: false }),
    supabase.from("transactions").select(transactionSelect).eq("user_id", userId).gte("date", spendingPeriod.start).lte("date", spendingPeriod.end).order("date", { ascending: false }),
    supabase.from("transactions").select(transactionSelect).eq("user_id", userId).order("date", { ascending: false }).limit(15),
    supabase.from("investment_holdings").select("id, plaid_account_id, security_id, ticker_symbol, security_name, quantity, institution_price, institution_value, cost_basis, currency, iso_currency_code").eq("user_id", userId).order("institution_value", { ascending: false }),
    supabase.from("investment_snapshots").select("id, plaid_item_id, plaid_account_id, snapshot_date, portfolio_value, securities_value, created_at").eq("user_id", userId).order("snapshot_date", { ascending: false }),
  ]);

  const legacyExampleMode = process.env.NODE_ENV === "development" && process.env.FINANCIAL_PROFILE_MODE === "legacy-example";
  const storedProfile = profileResult.data?.financial_profile;
  const profile = legacyExampleMode
    ? LEGACY_EXAMPLE_FINANCIAL_PROFILE
    : isFinancialProfile(storedProfile) ? storedProfile : STARTER_FINANCIAL_PROFILE;
  const normalizedProfile = normalizeFinancialProfile(profile);
  if (!legacyExampleMode && !profile.onboardingCompletedAt) redirect("/onboarding");
  const formatMoney = (value: number | string | null | undefined) => money(value, profile.currency);
  const formatAggregate = (value: number | null, currency: string | null, mixedCurrency: boolean) =>
    mixedCurrency || !currency ? "Unavailable" : money(value, currency);

  const accounts = (accountsResult.data ?? []) as DashboardAccount[];
  const recent = (recentResult.data ?? []) as RecentTransaction[];
  const holdings = (holdingsResult.data ?? []) as InvestmentHolding[];
  const snapshots = (snapshotsResult.data ?? []) as InvestmentSnapshot[];
  const view = buildDashboardViewModel({
    accounts,
    monthTransactions: (monthResult.data ?? []) as RecentTransaction[],
    historicalTransactions: (historyResult.data ?? []) as RecentTransaction[],
    weeklyTransactions: (weeklyResult.data ?? []) as RecentTransaction[],
    holdings,
    snapshots,
    now,
    profile,
  });
  const formatWeeklyMoney = (value: number | null) =>
    value == null ? "Unavailable" : view.weeklySpending.currency ? money(value, view.weeklySpending.currency) : "No currency";
  const dataUnavailable = Boolean(profileResult.error || accountsResult.error || monthResult.error || historyResult.error || weeklyResult.error || recentResult.error || holdingsResult.error || snapshotsResult.error);
  const nextPaycheck = view.financialPlan.nextPaycheck;
  const weeklyProgress = view.weeklySpending.target != null && view.weeklySpending.target > 0 && view.weeklySpending.eligibleSpending != null ? (view.weeklySpending.eligibleSpending / view.weeklySpending.target) * 100 : 0;
  const rothPlannedTotal = view.financialPlan.rothContributions.reduce((total, contribution) => total + contribution.amount, 0);
  const chartMax = Math.max(...view.monthlyHistory.flatMap((item) => [item.income, item.spending]), 1);
  const portfolioCurrency = view.financialPosition.equities.currency &&
    view.financialPosition.equities.currency === view.financialPosition.retirement.currency
    ? view.financialPosition.equities.currency
    : null;
  const currentInvestedPortfolioValue = portfolioCurrency &&
    view.financialPosition.equities.investedValue != null &&
    view.financialPosition.retirement.investedValue != null
    ? view.financialPosition.equities.investedValue + view.financialPosition.retirement.investedValue
    : null;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 lg:py-10">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-[var(--border)] pb-7">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--accent-ink)]">Personal finance · financial operating system</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Dick-Newport</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--text-muted)]">A clear view of your financial picture, with connected data and profile estimates kept distinct.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3"><span className="text-xs text-[var(--text-muted)]">Plaid connections paused</span><a href="/settings/profile" className="rounded border border-[var(--border)] px-4 py-2 text-sm font-medium">Financial profile</a><form action={signOut}><button className="rounded border border-[var(--border)] px-4 py-2 text-sm font-medium">Sign out</button></form></div>
        </header>

        {legacyExampleMode && <p className="mt-5 rounded border border-amber-300 bg-amber-50 p-3 text-sm">Development example plan is active. These planning values are not saved as your financial profile.</p>}

        {dataUnavailable && <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-muted)]">Some connected data is unavailable. Plan values remain visible; live balances appear when their source loads.</div>}

        <section className="mt-10">
          <SectionHeader eyebrow="Overview" title="Your monthly financial picture" detail="Estimate based on the financial profile. Complete, partial, and unavailable states are preserved; unknown inputs are not treated as zero." />
          <Panel className="mt-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <Metric label="Take-home income" value={formatMoney(view.financialPlanning.income.estimatedMonthlyTakeHomeIncome)} detail={planningDetail(view.financialPlanning.income.status, view.financialPlanning.income.excludedSources.length)} />
              <Metric label="Recurring expenses" value={formatMoney(view.financialPlanning.recurringExpenses.estimatedMonthlyExpenses)} detail={planningDetail(view.financialPlanning.recurringExpenses.status, view.financialPlanning.recurringExpenses.excludedItems.length)} />
              <Metric label="Debt payments" value={formatMoney(view.financialPlanning.debtPayments.monthlyAmount)} detail={planningDetail(view.financialPlanning.debtPayments.status, view.financialPlanning.debtPayments.excludedItems.length)} />
              <Metric label="Savings allocations" value={formatMoney(view.financialPlanning.savingsAllocations.monthlyAmount)} detail={planningDetail(view.financialPlanning.savingsAllocations.status, view.financialPlanning.savingsAllocations.excludedItems.length)} />
              <Metric label="Remaining monthly cash" value={formatMoney(view.financialPlanning.remainingMonthlyCash)} detail={view.financialPlanning.remainingMonthlyCash == null ? view.financialPlanning.remainingMonthlyCashReason : "Complete required cash-flow inputs"} positive={view.financialPlanning.remainingMonthlyCash != null && view.financialPlanning.remainingMonthlyCash >= 0} />
            </div>
            {view.financialPlanning.income.excludedSources.length > 0 && <p className="mt-4 text-xs leading-5 text-[var(--text-muted)]">Income excluded: {view.financialPlanning.income.excludedSources.map(({ source, reason }) => `${source.name} (${reason})`).join(", ")}</p>}
            {view.financialPlanning.recurringExpenses.excludedItems.length > 0 && <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Expenses excluded: {view.financialPlanning.recurringExpenses.excludedItems.map(({ name, exclusionReason }) => `${name} (${exclusionReason})`).join(", ")}</p>}
            {view.financialPlanning.debtPayments.excludedItems.length > 0 && <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Debt payments excluded: {view.financialPlanning.debtPayments.excludedItems.map(({ name, reason }) => `${name} (${reason})`).join(", ")}</p>}
            {view.financialPlanning.savingsAllocations.excludedItems.length > 0 && <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Savings excluded: {view.financialPlanning.savingsAllocations.excludedItems.map(({ name, reason }) => `${name} (${reason})`).join(", ")}</p>}
          </Panel>
        </section>

        <section className="mt-10">
          <SectionHeader eyebrow="Assets and liabilities" title="What you own and owe" detail="Connected balances, profile-entered accounts, properties, and debts are shown as separate sources and categories." />
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Panel>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Net worth</p>
              <p className="mt-4 text-4xl font-semibold tracking-tight text-[var(--text)]">{formatAggregate(view.overallPosition.netWorth, view.accountSummary.currency, view.accountSummary.mixedCurrency)}</p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">{view.profileAccountBalances.configured ? "Connected plus configured profile balances" : "Connected balances"}{!view.overallPosition.netWorthComplete ? " · incomplete; one or more balances are unknown or unsupported" : ""}</p>
              <p className="mt-2 text-xs text-[var(--text-muted)]">Connected: {formatAggregate(view.overallPosition.connectedNetWorth, view.connectedAccountSummary.currency, view.connectedAccountSummary.mixedCurrency)}{view.profileAccountBalances.configured ? ` · Profile accounts: ${formatMoney(view.overallPosition.profileAccountNetWorth)}` : ""}</p>
              {(!view.accountSummary.currency || view.accountSummary.mixedCurrency) && <p className="mt-2 text-xs text-[var(--text-muted)]">Totals are unavailable because one or more account currencies are mixed or unknown. No conversion is applied.</p>}
            </Panel>
            <Panel>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Checking</p>
              <p className="mt-4 text-4xl font-semibold tracking-tight text-[var(--text)]">{view.overallPosition.checkingAccounts.length > 0 ? formatAggregate(view.overallPosition.checkingBalance, view.connectedAccountSummary.currency, view.connectedAccountSummary.mixedCurrency) : "Not connected"}</p>
              <p className="mt-2 text-sm text-[var(--text-muted)]">Accounts classified as checking · reserve accounts are separate</p>
            </Panel>
          </div>
          {view.profileAccountBalances.configured && <Panel className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Profile account balances</p>
            <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Manual and profile-imported entries are separate from connected accounts and are included once. No name-based matching is available, so similarly named records remain separate.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-3"><Metric label="Cash / depository" value={formatMoney(view.profileAccountBalances.cash)} /><Metric label="Investments / retirement" value={formatMoney(view.profileAccountBalances.investments)} /><Metric label="Debt liabilities" value={formatMoney(view.profileAccountBalances.liabilities)} /></div>
            {view.profileAccountBalances.items.length === 0 ? <p className="mt-4 text-sm text-[var(--text-muted)]">No profile accounts configured. Legacy manual balance fields are not added to this collection.</p> : <div className="mt-4 divide-y divide-[var(--border)]">{view.profileAccountBalances.items.map((item, index) => <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-4 py-2 text-sm"><span className="min-w-0 truncate">{item.name} · {item.balanceSource === "imported" ? "Profile imported" : item.balanceSource === "manual" ? "Manual" : "Source unknown"} · {item.currency}{!item.included ? ` · ${item.exclusionReason}` : ""}</span><span className="shrink-0 font-medium">{item.balance == null ? "Unknown" : money(item.balance, item.currency)}</span></div>)}</div>}
            {view.profileAccountBalances.mixedCurrency && <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">Profile account totals are unavailable because balances use multiple currencies ({view.profileAccountBalances.currencies.join(", ")}). No currency conversion is applied.</p>}
            {profile.manualBalances && <p className="mt-3 text-xs text-[var(--text-muted)]">Legacy cash/savings values are not added while this account collection is configured.</p>}
            {!view.profileAccountBalances.complete && <p className="mt-3 text-xs text-[var(--text-muted)]">The profile account total may be incomplete because some balances are unknown or unsupported.</p>}
          </Panel>}
          {!view.profileAccountBalances.configured && (profile.manualBalances?.cash != null || profile.manualBalances?.savings != null) && <Panel className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">Your manual estimates</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2"><Metric label="Cash entered by you" value={formatMoney(profile.manualBalances.cash)} /><Metric label="Savings entered by you" value={formatMoney(profile.manualBalances.savings)} /></div>
            <p className="mt-3 text-xs text-[var(--text-muted)]">These estimates are separate from connected account balances and are not included in net worth.</p>
          </Panel>}
        </section>

        <section className="mt-12">
          <SectionHeader eyebrow="Profile assets and obligations" title="What you own and owe" detail="Property assets, profile accounts, and debts remain separate categories. Property values are not included in account balances or equity calculations." />
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <Panel>
              <h3 className="text-base font-semibold">Property assets</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Ownership-adjusted market values are shown without subtracting mortgage debt.</p>
              {view.properties.length === 0 ? <div className="mt-5"><Empty>No properties have been entered.</Empty></div> : <div className="mt-5 divide-y divide-[var(--border)]">{view.properties.map((property) => <div key={property.id} className="py-4 first:pt-0"><div className="flex items-start justify-between gap-4"><div><p className="font-medium">{property.name}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{propertyTypeLabel(property.propertyType)} · {property.ownershipPercentage.toFixed(1)}% ownership</p></div><div className="text-right"><p className="font-semibold">{property.estimatedMarketValue == null ? "Unknown" : money(property.estimatedMarketValue, property.currency)}</p><p className="mt-1 text-xs text-[var(--text-muted)]">Estimated market value</p></div></div><div className="mt-3 flex items-center justify-between gap-4 text-sm"><span className="text-[var(--text-muted)]">Ownership-adjusted value</span><span className="font-semibold">{property.ownershipAdjustedValue == null ? "Unknown" : money(property.ownershipAdjustedValue, property.currency)} {property.currency}</span></div></div>)}</div>}
            </Panel>
            <Panel>
              <h3 className="text-base font-semibold">Debt overview</h3>
              <p className="mt-1 text-sm text-[var(--text-muted)]">Profile debts are shown separately from financial-account liabilities.</p>
              {view.debts.length === 0 ? <div className="mt-5"><Empty>No debts have been entered.</Empty></div> : <div className="mt-5 divide-y divide-[var(--border)]">{view.debts.map((debt, index) => <div key={`${debt.name}-${index}`} className="py-4 first:pt-0"><div className="flex items-start justify-between gap-4"><div><p className="font-medium">{debt.name}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{debtTypeLabel(debt.type)}</p></div><p className="font-semibold">{debt.balance == null ? "Unknown balance" : formatMoney(debt.balance)}</p></div><div className="mt-3 grid grid-cols-2 gap-3 text-sm"><Metric label="Annual interest" value={debt.annualInterestRatePercent == null ? "Unknown" : `${debt.annualInterestRatePercent.toFixed(2)}%`} /><Metric label="Minimum payment" value={debt.minimumPayment == null ? "Unknown" : formatMoney(debt.minimumPayment)} detail={debt.minimumPayment == null ? undefined : debt.paymentFrequency ?? "Frequency unknown"} /></div></div>)}</div>}
            </Panel>
          </div>
        </section>

        <section className="mt-12">
          <SectionHeader eyebrow="Retirement and goals" title="Plans beyond monthly cash flow" detail="Income and recurring-expense records provide detail; retirement plans, employer matches, and goals remain separate from cash-flow calculations." />
          <Panel className="mt-5">
            <div className="mt-6 grid gap-4 border-t border-[var(--border)] pt-5 lg:grid-cols-2">
              <div><h3 className="font-semibold">Income sources</h3>{normalizedProfile.incomeSources?.length ? <div className="mt-3 divide-y divide-[var(--border)]">{normalizedProfile.incomeSources.map((source, index) => <div key={`${source.name}-${index}`} className="flex items-center justify-between gap-4 py-2 text-sm"><span>{source.name} <span className="text-xs text-[var(--text-muted)]">· {source.type}</span></span><span>{source.amount == null ? "Unknown" : money(source.amount, profile.currency)}{source.frequency ? ` / ${source.frequency}` : ""}</span></div>)}</div> : <p className="mt-2 text-sm text-[var(--text-muted)]">No income sources are configured.</p>}</div>
              <div><h3 className="font-semibold">Recurring expenses</h3>{normalizedProfile.recurringExpenses?.length ? <div className="mt-3 divide-y divide-[var(--border)]">{normalizedProfile.recurringExpenses.map((expense, index) => <div key={`${expense.name}-${index}`} className="flex items-center justify-between gap-4 py-2 text-sm"><span>{expense.name} <span className="text-xs text-[var(--text-muted)]">· {expense.category ?? "Uncategorized"}</span></span><span>{expense.amount == null ? "Unknown" : money(expense.amount, profile.currency)}{expense.frequency ? ` / ${expense.frequency}` : ""}</span></div>)}</div> : <p className="mt-2 text-sm text-[var(--text-muted)]">No recurring expenses are configured.</p>}</div>
            </div>
            <div className="mt-6 grid gap-4 border-t border-[var(--border)] pt-5 lg:grid-cols-2">
              <div><h3 className="font-semibold">Retirement contributions</h3>{view.retirementContributionPlans.length ? <div className="mt-3 divide-y divide-[var(--border)]">{view.retirementContributionPlans.map((plan, index) => { const contribution = plan.contribution; const contributionText = contribution.basis === "amount" ? contribution.amount == null ? "Amount unknown" : formatMoney(contribution.amount) : contribution.basis === "percentage" ? contribution.percentage == null ? "Percentage unknown" : `${contribution.percentage}% of ${contribution.percentageOf}` : "Legacy amount / percentage unresolved"; return <div key={`${plan.name}-${index}`} className="py-2 text-sm"><div className="flex items-center justify-between gap-4"><span>{plan.name}</span><span>{contributionText}</span></div><p className="mt-1 text-xs text-[var(--text-muted)]">{contribution.frequency ? `${contribution.frequency} · ` : ""}{plan.employerMatch?.percentage == null ? "Employer match unknown" : `Employer match ${plan.employerMatch.percentage}%${plan.employerMatch.maximumPercentageOfSalary == null ? "" : ` up to ${plan.employerMatch.maximumPercentageOfSalary}% of salary`}`}</p></div>; })}</div> : <p className="mt-2 text-sm text-[var(--text-muted)]">No retirement contribution plans are configured.</p>}{view.financialPlanning.retirementContributions.excludedItems.length > 0 && <p className="mt-3 text-xs text-[var(--text-muted)]">Monthly contribution estimate exclusions: {view.financialPlanning.retirementContributions.excludedItems.map(({ name, reason }) => `${name} (${reason})`).join(", ")}</p>}</div>
              <div><h3 className="font-semibold">Financial goals</h3>{view.goals.length ? <div className="mt-3 divide-y divide-[var(--border)]">{view.financialPlanning.goals.map((goal, index) => <div key={`${goal.name}-${index}`} className="flex items-center justify-between gap-4 py-2 text-sm"><span>{goal.name}</span><span className="text-right">{goal.targetAmount == null ? "Target unknown" : formatMoney(goal.targetAmount)}{goal.targetDate ? ` · ${formatDate(goal.targetDate)}` : " · Date unknown"}</span></div>)}</div> : <p className="mt-2 text-sm text-[var(--text-muted)]">No financial goals are configured.</p>}<p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">Goal progress is unavailable because goals are not linked to specific funding accounts or allocations.</p></div>
            </div>
          </Panel>
        </section>

        <section className="mt-10">
          <SectionHeader eyebrow="Assets and investments" title="Connected financial position" detail="Connected account balances and holdings are shown separately from profile-entered properties, accounts, and debts." />
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            <PositionCard label="Investments" description="Taxable investment accounts classified from account metadata" position={view.financialPosition.equities}>
              <p className="mt-5 text-xs text-[var(--text-muted)]">Flexible invested money · holdings below</p>
            </PositionCard>
            <PositionCard label="Retirement" description="Retirement accounts classified from account metadata" position={view.financialPosition.retirement} accent>
              {profile.roth ? <div className="mt-5 border-t border-[var(--border)] pt-4"><div className="flex justify-between text-xs"><span className="text-[var(--text-muted)]">Planned contribution amount remaining</span><span className="font-semibold text-[var(--text)]">{formatMoney(view.financialPlan.rothRemaining)}</span></div><p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Progress against actual contribution history is unavailable. Scheduled amount: {formatMoney(rothPlannedTotal)}</p></div> : <p className="mt-5 border-t border-[var(--border)] pt-4 text-xs leading-5 text-[var(--text-muted)]">No retirement contribution schedule has been entered.</p>}
            </PositionCard>
            <Panel>
              <div className="flex items-start justify-between gap-4"><div><h3 className="text-base font-semibold">HYSA</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Bills and cash-reserve bucket</p></div><span className="text-xs font-medium text-[var(--text-muted)]">{view.financialPosition.hysa.accounts.length} account{view.financialPosition.hysa.accounts.length === 1 ? "" : "s"}</span></div>
              <p className="mt-7 text-3xl font-semibold tracking-tight">{view.financialPosition.hysa.accounts.length > 0 ? (view.financialPosition.hysa.currentBalance == null || !view.financialPosition.hysa.currency ? "Unavailable" : money(view.financialPosition.hysa.currentBalance, view.financialPosition.hysa.currency)) : "Not connected"}</p>
              <div className="mt-6 grid grid-cols-2 gap-4 border-t border-[var(--border)] pt-4"><Metric label="Monthly bills" value={formatMoney(view.financialPlan.bills.monthlyObligations.total)} /><Metric label="Per paycheck" value={formatMoney(view.financialPlan.bills.perPaycheckAllocation)} /></div>
              <div className="mt-5 flex items-center justify-between text-sm"><span className="text-[var(--text-muted)]">Configured plan APY</span><span className="font-semibold text-[var(--text)]">{view.financialPosition.hysa.configuredApy == null ? "Not entered" : `${(view.financialPosition.hysa.configuredApy * 100).toFixed(2)}%`}</span></div>
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Plan value only, not a live APY reading. Intended for bills and reserve funding.</p>
            </Panel>
          </div>
        </section>

        <section className="mt-12">
          <SectionHeader eyebrow="Connected activity" title="Weekly spending" detail="Purchases and subscriptions count. Card payments, transfers, investments, and funding offsets do not count as spending." />
          <Panel className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-sm text-[var(--text-muted)]">Current period</p><p className="mt-1 text-lg font-semibold">{formatDate(view.weeklySpending.periodStart)} – {formatDate(view.weeklySpending.periodEnd)}</p></div><div className="text-left sm:text-right"><p className="text-sm text-[var(--text-muted)]">Weekly target</p><p className="mt-1 text-3xl font-semibold">{formatMoney(view.weeklySpending.target)}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{formatMoney(view.weeklySpending.dailyTarget)} per day reference</p></div></div>
            <div className="mt-7"><div className="flex justify-between text-sm"><span className="text-[var(--text-muted)]">Eligible spending</span><span className="font-semibold">{formatWeeklyMoney(view.weeklySpending.eligibleSpending)} · {percent(view.weeklySpending.spendingPercentage)}</span></div><ProgressBar value={weeklyProgress} className="mt-3 h-3" /></div>
            {view.weeklySpending.target != null && view.weeklySpending.eligibleSpending != null && view.weeklySpending.eligibleSpending > view.weeklySpending.target && <p className="mt-3 text-sm font-semibold text-[var(--down)]">{formatWeeklyMoney(view.weeklySpending.eligibleSpending - view.weeklySpending.target)} over target</p>}
            <div className="mt-7 grid gap-5 border-t border-[var(--border)] pt-5 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Remaining budget" value={formatWeeklyMoney(view.weeklySpending.remainingBudget)} /><Metric label="Eligible funding offset" value={formatWeeklyMoney(view.weeklySpending.venmoBalance)} detail="Separate from spending" /><Metric label="Remaining funding need" value={formatWeeklyMoney(view.weeklySpending.remainingFundingNeed)} positive={view.weeklySpending.remainingFundingNeed === 0} /><Metric label="Transactions counted" value={String(view.weeklySpending.transactionCount)} detail="Eligible activity" /></div>
          </Panel>
        </section>

        {(legacyExampleMode || profile.paychecks || profile.roth || profile.bills || profile.weeklySpending) && <section className="mt-12">
          <SectionHeader eyebrow="Legacy plan details" title="Additional plan details" detail="These optional legacy fields remain available for backward compatibility and the development example mode." />
          <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Panel>
              <div className="flex flex-wrap items-end justify-between gap-4"><div><h3 className="text-base font-semibold">Recurring monthly outlook</h3><p className="mt-1 text-xs text-[var(--text-muted)]">Profile-based estimates; they may exclude irregular expenses or obligations that have not been entered.</p></div><p className="text-sm text-[var(--text-muted)]">{nextPaycheck ? `Next planned: ${formatDate(nextPaycheck.date)}` : "No future payday configured"}</p></div>
              <div className="mt-5 grid gap-4 sm:grid-cols-3">
                <Metric label="Take-home income estimate" value={formatMoney(view.monthlyIncomeEstimate.estimatedMonthlyTakeHomeIncome)} detail={view.monthlyIncomeEstimate.partial ? `Partial · ${view.monthlyIncomeEstimate.excludedSources.length} source(s) excluded` : view.monthlyIncomeEstimate.legacyFallbackUsed ? "Legacy monthly budget income" : normalizedProfile.incomeSources !== undefined ? "Configured income sources" : "Not configured"} />
                <Metric label="Recurring expense estimate" value={formatMoney(view.monthlyExpenseEstimate.estimatedMonthlyExpenses)} detail={!view.monthlyExpenseEstimate.configured ? "No collection configured" : `Included ${view.monthlyExpenseEstimate.includedCount} of ${view.monthlyExpenseEstimate.recordCount} records${view.monthlyExpenseEstimate.partial ? " · partial" : ""}`} />
                <Metric label="Estimated recurring cash flow" value={formatMoney(view.financialPlan.estimatedRecurringCashFlow)} detail={view.financialPlan.estimatedRecurringCashFlow == null ? "Unavailable until income and expenses are configured" : view.financialPlan.recurringCashFlowComplete ? "Complete profile estimate" : "Partial profile estimate"} positive={view.financialPlan.estimatedRecurringCashFlow != null && view.financialPlan.estimatedRecurringCashFlow >= 0} />
              </div>
              {view.monthlyIncomeEstimate.excludedSources.length > 0 && <p className="mt-3 text-xs leading-5 text-[var(--text-muted)]">Income excluded: {view.monthlyIncomeEstimate.excludedSources.map(({ source, reason }) => `${source.name} (${reason})`).join(", ")}</p>}
              {view.monthlyExpenseEstimate.excludedItems.length > 0 && <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">Expenses excluded: {view.monthlyExpenseEstimate.excludedItems.map(({ name, exclusionReason }) => `${name} (${exclusionReason})`).join(", ")}</p>}
              <div className="mt-7 grid gap-4 sm:grid-cols-2"><Metric label="Retirement contribution preference" value={formatMoney(profile.retirementContributions?.perPaycheck ?? view.financialPlan.paycheck.rothContribution)} /><Metric label="Employer match" value={profile.retirementContributions?.employerMatchPercentage == null ? "Not entered" : `${profile.retirementContributions.employerMatchPercentage}%`} /><Metric label="HYSA / bills" value={formatMoney(view.financialPlan.paycheck.billsAllocation)} /><Metric label="Weekly spending" value={formatMoney(view.financialPlan.paycheck.weeklySpendingAllocation)} /><Metric label="Cushion" value={formatMoney(view.financialPlan.paycheck.cushion)} /></div>
              <div className="mt-6 grid gap-4 border-t border-[var(--border)] pt-5 sm:grid-cols-3"><Metric label="Monthly spending target" value={formatMoney(profile.budget?.monthlySpendingTarget)} /><Metric label="Emergency-fund target" value={formatMoney(profile.savingsTargets?.emergencyFund)} /><Metric label="Minimum cash buffer" value={formatMoney(profile.savingsTargets?.minimumCashBuffer)} /></div>
            </Panel>
            <Panel>
              {profile.roth ? <><div className="flex items-end justify-between gap-4"><div><h3 className="font-semibold">Retirement contribution schedule</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Configured remaining: {formatMoney(view.financialPlan.rothRemaining)}</p></div><p className="text-sm font-semibold text-[var(--accent-ink)]">{formatMoney(rothPlannedTotal)} planned</p></div><div className="mt-5 divide-y divide-[var(--border)]">{view.financialPlan.rothContributions.map((contribution) => <div key={contribution.date} className="flex items-center justify-between gap-4 py-3 first:pt-0"><span className="text-sm text-[var(--text-muted)]">{formatDate(contribution.date)}{contribution.mayExecuteOnNextTradingDay ? " · next trading day" : ""}</span><span className="font-semibold">{formatMoney(contribution.amount)}</span></div>)}</div></> : <><h3 className="font-semibold">Retirement contribution schedule</h3><p className="mt-2 text-sm text-[var(--text-muted)]">No dated contribution schedule is configured.</p></>}
            </Panel>
          </div>
        </section>}

        <section className="mt-12">
          <SectionHeader eyebrow="Connected activity" title="Invested money, by purpose" detail="Holdings, allocation, cash, and gains are shown only where connected data supports them." />
          <div className="mt-5 grid gap-4 lg:grid-cols-2"><PortfolioTable title="Taxable equities" position={view.financialPosition.equities} /><PortfolioTable title="Retirement accounts" position={view.financialPosition.retirement} /></div>
        </section>

        <section className="mt-12">
          <SectionHeader eyebrow="Connected activity" title="Portfolio growth" detail="Securities-only portfolio observations across connected investment accounts." />
          <Panel className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-5">
              <div><p className="text-xs text-[var(--text-muted)]">Current invested portfolio value</p><p className="mt-1 text-3xl font-semibold tracking-tight">{currentInvestedPortfolioValue == null || !portfolioCurrency ? "Unavailable" : money(currentInvestedPortfolioValue, portfolioCurrency)}</p></div>
              {view.portfolioGrowth.changeSinceFirstSnapshot == null || !view.portfolioGrowth.currency ? <p className="text-sm text-[var(--text-muted)]">Change since first snapshot: Unavailable</p> : <p className={view.portfolioGrowth.changeSinceFirstSnapshot >= 0 ? "text-sm font-semibold text-[var(--up)]" : "text-sm font-semibold text-[var(--down)]"}>Change since first snapshot: {signedMoney(view.portfolioGrowth.changeSinceFirstSnapshot, view.portfolioGrowth.currency)}</p>}
            </div>
            <div className="mt-7">{view.portfolioGrowth.currency ? <PortfolioGrowthChart observations={view.portfolioGrowth.observations} currency={view.portfolioGrowth.currency} /> : <Empty>Portfolio history is unavailable until all snapshots have a known compatible currency.</Empty>}</div>
          </Panel>
        </section>

        <section className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Panel>
            <div className="flex items-end justify-between gap-4"><SectionHeader eyebrow="Connected activity" title="Recent financial rhythm" /><div className="text-right"><p className="text-xs text-[var(--text-muted)]">Actual transactions · this month</p><p className="mt-1 text-sm font-semibold">{view.monthly.currencySafe && view.monthly.currency ? `${money(view.monthly.income, view.monthly.currency)} in · ${money(view.monthly.spending, view.monthly.currency)} out` : "Unavailable · mixed or unknown currencies"}</p></div></div>
            {view.monthlyHistory.some((item) => !item.currencySafe) ? <p className="mt-7 text-sm text-[var(--text-muted)]">Historical transaction totals are unavailable for periods with mixed or unknown account currencies.</p> : <div className="mt-7 flex h-36 items-end gap-3">{view.monthlyHistory.map((item) => <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2"><div className="flex h-28 items-end gap-1"><i className="w-2 rounded-t bg-[var(--accent)]" style={{ height: `${Math.max((item.income / chartMax) * 100, item.income ? 4 : 0)}%` }} /><i className="w-2 rounded-t bg-[var(--text)]" style={{ height: `${Math.max((item.spending / chartMax) * 100, item.spending ? 4 : 0)}%` }} /></div><span className="text-xs text-[var(--text-muted)]">{item.label}</span></div>)}</div>}
          </Panel>
          <Panel>
            <SectionHeader eyebrow="Attention" title="What deserves a look" />
            <div className="mt-5 space-y-4 text-sm leading-6 text-[var(--text-muted)]"><p>{view.financialPosition.hysa.accounts.length === 0 ? "No reserve account is currently connected or designated." : "Your reserve account is separated from general spending cash."}</p><p>{view.weeklySpending.remainingFundingNeed == null ? "Enter a weekly target to calculate remaining funding need." : view.weeklySpending.remainingFundingNeed > 0 ? `${formatWeeklyMoney(view.weeklySpending.remainingFundingNeed)} still needs funding after the connected offset.` : "This week's configured spending target is covered after the connected offset."}</p><p>{nextPaycheck ? `Next plan checkpoint: ${formatDate(nextPaycheck.date)}.` : "No future paycheck is configured beyond the current schedule."}</p></div>
          </Panel>
        </section>

        <section className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <Panel>
            <SectionHeader eyebrow="Connected activity" title="Latest transactions" />
            <div className="mt-5 divide-y divide-[var(--border)]">{recent.length === 0 ? <Empty>No recent transactions available.</Empty> : recent.slice(0, 8).map((transaction) => { const amount = number(transaction.amount); const currency = accountCurrency(view.accounts.find((account) => account.id === transaction.account_id || account.plaid_account_id === transaction.account_id)); return <div key={transaction.id} className="flex justify-between gap-4 py-3 first:pt-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{transaction.merchant_name ?? transaction.name ?? "Unknown transaction"}</p><p className="mt-1 truncate text-xs text-[var(--text-muted)]">{transaction.date} · {transactionCategory(transaction)}{transaction.pending ? " · Pending" : ""}</p></div><p className={amount != null && amount < 0 ? "text-sm font-semibold text-[var(--up)]" : "text-sm font-semibold"}>{currency ? money(amount, currency) : "Unknown currency"}</p></div>; })}</div>
          </Panel>
          <Panel>
            <SectionHeader eyebrow="Connected accounts" title="Account map" detail="Purpose labels keep account roles clear without exposing IDs." />
            <div className="mt-5 divide-y divide-[var(--border)]">{view.accounts.length === 0 ? <Empty>No connected accounts yet.</Empty> : view.accounts.map((account) => <div key={account.id} className="flex justify-between gap-4 py-3 first:pt-0"><div className="min-w-0"><p className="truncate text-sm font-medium">{accountName(account)}</p><p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--text-muted)]">{account.accountClass} · {account.currency ?? "currency unknown"}</p></div><p className="text-sm font-semibold">{account.currency ? money(account.current_balance, account.currency) : "Unknown currency"}</p></div>)}</div>
          </Panel>
        </section>

        <section className="mt-12 border-t border-[var(--border)] pt-7"><div><p className="text-sm font-semibold">Rewards tracking</p><p className="mt-1 text-sm text-[var(--text-muted)]">No rewards programs are configured for this profile.</p></div></section>
      </div>
    </main>
  );
}
