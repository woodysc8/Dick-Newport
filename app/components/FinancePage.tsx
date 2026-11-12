import { institutionDisplayLabel } from "../../lib/dashboard";
import { redirect } from "next/navigation";
import { signOut } from "../auth/actions";
import { getDashboardAccountClass, type DashboardAccount, type InvestmentHolding } from "../../lib/dashboard";
import { calculateFinancialPlanning } from "../../lib/financialPlanning";
import { STARTER_FINANCIAL_PROFILE, type FinancialProfile } from "../../lib/financialProfileDefaults";
import { normalizeFinancialProfile } from "../../lib/financialProfileNormalization";
import { createSupabaseServerClient, ensureOwnProfile } from "../../lib/supabase/server";
import FinanceNav from "./FinanceNav";
import WeeklyBudget from "./WeeklyBudget";
import BudgetEngine from "./BudgetEngine";

type Section = "Accounts" | "Budget" | "Paychecks" | "Debt" | "Investments" | "Goals" | "Reports";

export function PagePanel({ children }: { children: React.ReactNode }) {
  return <section className="finance-panel rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 sm:p-6">{children}</section>;
}

function money(value: number | undefined, currency: string): string {
  return value == null || !Number.isFinite(value) ? "Unknown" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

function profileFrom(value: unknown): FinancialProfile {
  return value && typeof value === "object" && !Array.isArray(value) ? normalizeFinancialProfile(value as FinancialProfile) : STARTER_FINANCIAL_PROFILE;
}

export function Shell({ active, title, description, children }: { active: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-[var(--bg)] text-[var(--text)]">
      <div className="mx-auto max-w-7xl px-5 py-6 sm:px-8 lg:py-9">
        <header className="border-b border-[var(--border)] pb-6">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Dick-Newport</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">{description}</p></div>
            <div className="flex items-center gap-3"><a href="/settings/profile" className="rounded border border-[var(--border)] px-3 py-2 text-sm font-medium">Profile</a><form action={signOut}><button className="rounded border border-[var(--border)] px-3 py-2 text-sm font-medium">Sign out</button></form></div>
          </div>
          <div className="mt-6 overflow-x-auto"><FinanceNav active={active} /></div>
        </header>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="rounded border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-sm leading-6 text-[var(--text-muted)]">{children}</div>;
}

export default async function FinancePage({ section }: { section: Section }) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  await ensureOwnProfile(supabase, auth.user.id);
  const { data } = await supabase.from("profiles").select("financial_profile").eq("id", auth.user.id).maybeSingle();
  const profile = profileFrom(data?.financial_profile);

  if (section === "Accounts") {
    const { data: accounts } = await supabase.from("accounts").select("id, institution_name, account_name, account_type, account_subtype, current_balance, currency, plaid_account_id").eq("user_id", auth.user.id).order("created_at", { ascending: false });
    const rows = (accounts ?? []) as DashboardAccount[];
    return <Shell active={section} title="Accounts" description="Connected balances and manually entered accounts stay clearly separated.">
      <WeeklyBudget sourcesOnly />
      <div className="grid gap-4 sm:grid-cols-3"><PagePanel><p className="text-sm text-[var(--text-muted)]">Connected accounts</p><p className="mt-2 text-3xl font-semibold">{rows.length}</p></PagePanel><PagePanel><p className="text-sm text-[var(--text-muted)]">Manual accounts</p><p className="mt-2 text-3xl font-semibold">{profile.financialAccounts?.length ?? 0}</p></PagePanel><PagePanel><p className="text-sm text-[var(--text-muted)]">Action</p><p className="mt-2 text-sm">Use the dashboard control to connect an account.</p></PagePanel></div>
      <PagePanel><h2 className="text-lg font-semibold">Connected accounts</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Balances are actual imported observations. No currency conversion is applied.</p>{rows.length === 0 ? <div className="mt-5"><EmptyState>No connected accounts yet. Connect an account from the Overview.</EmptyState></div> : <div className="mt-5 divide-y divide-[var(--border)]">{rows.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{institutionDisplayLabel(account.institution_name)} · {account.account_name ?? "Unnamed account"}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{account.account_type ?? "Unknown type"} · {account.plaid_account_id ? "Plaid connected" : "Source unavailable"}</p></div><p className="font-semibold">{account.current_balance == null ? "Unknown" : money(Number(account.current_balance), account.currency ?? profile.currency)}</p></div>)}</div>}</PagePanel>
      <PagePanel><h2 className="text-lg font-semibold">Manual accounts</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Configured estimates are not treated as connected balances.</p>{profile.financialAccounts?.length ? <div className="mt-4 divide-y divide-[var(--border)]">{profile.financialAccounts.map((account, index) => <div key={`${account.name}-${index}`} className="flex justify-between gap-4 py-3 text-sm"><span>{account.name} · {account.accountType}</span><span>{account.balance == null ? "Unknown" : money(account.balance, account.currency ?? profile.currency)}</span></div>)}</div> : <div className="mt-4"><EmptyState>No manual accounts configured.</EmptyState></div>}</PagePanel>
    </Shell>;
  }

  if (section === "Investments") {
    const [{ data: accounts }, { data: holdings }, { data: snapshots }] = await Promise.all([
      supabase.from("accounts").select("id, institution_name, account_name, account_type, account_subtype, current_balance, currency, plaid_account_id").eq("user_id", auth.user.id),
      supabase.from("investment_holdings").select("id, plaid_account_id, security_name, ticker_symbol, institution_value, currency, iso_currency_code").eq("user_id", auth.user.id).order("institution_value", { ascending: false }),
      supabase.from("investment_snapshots").select("snapshot_date, portfolio_value, securities_value").eq("user_id", auth.user.id).order("snapshot_date", { ascending: true }),
    ]);
    const investmentAccounts = ((accounts ?? []) as DashboardAccount[]).filter((account) => ["investment", "retirement"].includes(getDashboardAccountClass(account)));
    const rows = (holdings ?? []) as InvestmentHolding[];
    const holdingCurrencies = new Set(rows.map((holding) => holding.currency ?? holding.iso_currency_code ?? profile.currency).filter((currency): currency is string => /^[A-Z]{3}$/.test(currency)));
    const portfolioCurrency = holdingCurrencies.size === 1 ? [...holdingCurrencies][0] : null;
    const portfolioValue = portfolioCurrency && rows.length > 0 && rows.every((holding) => holding.institution_value != null)
      ? rows.reduce((total, holding) => total + Number(holding.institution_value), 0)
      : null;
    const chartPoints = (snapshots ?? [])
      .map((snapshot) => Number(snapshot.securities_value ?? snapshot.portfolio_value))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const chartMax = Math.max(...chartPoints, 1);
    const performance = chartPoints.length >= 2 ? chartPoints[chartPoints.length - 1] - chartPoints[0] : null;
    return <Shell active={section} title="Investments" description="Connected brokerage and retirement positions, with unknown and mixed currencies kept unavailable.">
      <PagePanel><div className="flex flex-wrap items-end justify-between gap-5"><div><p className="text-sm text-[var(--text-muted)]">Total portfolio value</p><p className="mt-2 text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">{portfolioValue == null || !portfolioCurrency ? "Unavailable" : money(portfolioValue, portfolioCurrency)}</p></div><div className="text-right"><p className="text-sm text-[var(--text-muted)]">Period performance</p><p className={`mt-2 text-lg font-semibold ${performance != null && performance >= 0 ? "text-[var(--up)]" : "text-[var(--text)]"}`}>{performance == null || !portfolioCurrency ? "Unavailable" : `${performance >= 0 ? "+" : ""}${money(performance, portfolioCurrency)}`}</p></div></div>{chartPoints.length >= 2 && <div className="mt-8"><svg className="h-40 w-full" viewBox="0 0 640 160" role="img" aria-label="Portfolio value history"><polyline fill="none" points={chartPoints.map((value, index) => `${(index / (chartPoints.length - 1)) * 620 + 10},${150 - (value / chartMax) * 130}`).join(" ")} stroke="var(--accent)" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" /></svg><div className="flex justify-between text-xs text-[var(--text-muted)]"><span>Earlier</span><span>Latest</span></div></div>}{chartPoints.length < 2 && <p className="mt-8 text-sm text-[var(--text-muted)]">Portfolio history will appear after compatible connected snapshots are available.</p>}</PagePanel>
      <div className="grid gap-4 sm:grid-cols-3"><PagePanel><p className="text-sm text-[var(--text-muted)]">Investment accounts</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{investmentAccounts.length}</p></PagePanel><PagePanel><p className="text-sm text-[var(--text-muted)]">Holdings</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em]">{rows.length}</p></PagePanel><PagePanel><p className="text-sm text-[var(--text-muted)]">Buying power</p><p className="mt-2 text-sm text-[var(--text-muted)]">Available when connected cash positions are supported.</p></PagePanel></div>
      <PagePanel><h2 className="text-lg font-semibold">Holdings</h2>{rows.length === 0 ? <div className="mt-4"><EmptyState>No connected investment holdings are available.</EmptyState></div> : <div className="mt-4 divide-y divide-[var(--border)]">{rows.map((holding) => <div key={holding.id} className="flex justify-between gap-4 py-3 text-sm"><span>{holding.security_name ?? holding.ticker_symbol ?? "Unnamed security"}</span><span>{holding.institution_value == null ? "Unknown" : money(Number(holding.institution_value), holding.currency ?? holding.iso_currency_code ?? profile.currency)}</span></div>)}</div>}</PagePanel>
      <PagePanel><h2 className="text-lg font-semibold">Retirement contributions</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Contribution plans are configured separately from actual account balances.</p>{profile.retirementContributionPlans?.length ? <div className="mt-4 divide-y divide-[var(--border)]">{profile.retirementContributionPlans.map((plan, index) => <div key={`${plan.name}-${index}`} className="py-3 text-sm"><div className="flex justify-between gap-4"><span>{plan.name}</span><span>{plan.contribution.basis === "amount" ? plan.contribution.amount == null ? "Unknown" : money(plan.contribution.amount, profile.currency) : plan.contribution.percentage == null ? "Unknown" : `${plan.contribution.percentage}%`}</span></div><p className="mt-1 text-xs text-[var(--text-muted)]">{plan.employerMatch?.percentage == null ? "Employer match unknown" : `Employer match ${plan.employerMatch.percentage}%`}</p></div>)}</div> : <div className="mt-4"><EmptyState>No retirement contribution plans configured.</EmptyState></div>}</PagePanel>
    </Shell>;
  }

  const planning = calculateFinancialPlanning(profile);
  const title = section;
  const descriptions: Record<Section, string> = {
    Budget: "Plan monthly spending and compare actual transactions where connected data supports it.",
    Paychecks: "Keep income schedules, bills, savings allocations, and paycheck planning together.",
    Debt: "Track configured debt balances and payment obligations without mixing them with connected accounts.",
    Goals: "Set targets and dates without presenting allocations as actual account balances.",
    Reports: "A home for historical cash flow, spending, net worth, and investment reporting as data becomes available.",
    Accounts: "",
    Investments: "",
  };
  if (section === "Debt") return <Shell active={section} title={title} description={descriptions[section]}><PagePanel><h2 className="text-lg font-semibold">Debt obligations</h2>{profile.debts?.length ? <div className="mt-4 divide-y divide-[var(--border)]">{profile.debts.map((debt, index) => <div key={`${debt.name}-${index}`} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{debt.name}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{debt.type ?? "Type not entered"} · minimum payment {debt.minimumPayment == null ? "unknown" : money(debt.minimumPayment, profile.currency)}</p></div><span className="font-semibold">{debt.balance == null ? "Unknown balance" : money(debt.balance, profile.currency)}</span></div>)}</div> : <EmptyState>No debt information configured.</EmptyState>}</PagePanel></Shell>;
  if (section === "Goals") return <Shell active={section} title={title} description={descriptions[section]}><PagePanel><h2 className="text-lg font-semibold">Financial goals</h2>{profile.goals?.length ? <div className="mt-4 divide-y divide-[var(--border)]">{profile.goals.map((goal, index) => <div key={`${goal.name}-${index}`} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span className="font-medium">{goal.name}</span><span>{goal.targetAmount == null ? "Target unknown" : money(goal.targetAmount, profile.currency)}{goal.targetDate ? ` · ${goal.targetDate}` : ""}</span></div>)}</div> : <EmptyState>No financial goals configured.</EmptyState>}<p className="mt-4 text-xs text-[var(--text-muted)]">Progress remains unavailable until a goal is explicitly linked to funding data.</p></PagePanel></Shell>;
  if (section === "Paychecks") return <Shell active={section} title={title} description={descriptions[section]}><PagePanel><h2 className="text-lg font-semibold">Income and paycheck plan</h2>{profile.incomeSources?.length ? <div className="mt-4 divide-y divide-[var(--border)]">{profile.incomeSources.map((source, index) => <div key={`${source.name}-${index}`} className="flex justify-between gap-4 py-3 text-sm"><span>{source.name} · {source.type}</span><span>{source.amount == null ? "Unknown" : money(source.amount, profile.currency)}{source.frequency ? ` / ${source.frequency}` : ""}</span></div>)}</div> : <EmptyState>No income sources configured. Add them in Financial profile.</EmptyState>}<div className="mt-6 grid gap-4 border-t border-[var(--border)] pt-5 sm:grid-cols-3"><div><p className="text-xs text-[var(--text-muted)]">Next paycheck</p><p className="mt-1 text-sm">Not configured</p></div><div><p className="text-xs text-[var(--text-muted)]">Expected take-home</p><p className="mt-1 text-sm">{planning.income.estimatedMonthlyTakeHomeIncome == null ? "Unknown" : money(planning.income.estimatedMonthlyTakeHomeIncome, profile.currency)} monthly</p></div><div><p className="text-xs text-[var(--text-muted)]">Planned savings</p><p className="mt-1 text-sm">{planning.savingsAllocations.monthlyAmount == null ? "Unknown" : money(planning.savingsAllocations.monthlyAmount, profile.currency)} monthly</p></div></div></PagePanel></Shell>;
  if (section === "Budget") return <Shell active={section} title={title} description={descriptions[section]}><WeeklyBudget editable /><BudgetEngine editable /><div className="grid gap-4 sm:grid-cols-3"><PagePanel><p className="text-sm text-[var(--text-muted)]">Monthly income</p><p className="mt-2 text-2xl font-semibold">{planning.income.estimatedMonthlyTakeHomeIncome == null ? "Unknown" : money(planning.income.estimatedMonthlyTakeHomeIncome, profile.currency)}</p></PagePanel><PagePanel><p className="text-sm text-[var(--text-muted)]">Recurring expenses</p><p className="mt-2 text-2xl font-semibold">{planning.recurringExpenses.estimatedMonthlyExpenses == null ? "Unknown" : money(planning.recurringExpenses.estimatedMonthlyExpenses, profile.currency)}</p></PagePanel><PagePanel><p className="text-sm text-[var(--text-muted)]">Remaining cash</p><p className="mt-2 text-2xl font-semibold">{planning.remainingMonthlyCash == null ? "Unknown" : money(planning.remainingMonthlyCash, profile.currency)}</p></PagePanel></div><PagePanel><h2 className="text-lg font-semibold">Budget categories</h2>{profile.budget?.expenses?.length ? <div className="mt-4 divide-y divide-[var(--border)]">{profile.budget.expenses.map((expense, index) => <div key={`${expense.name}-${index}`} className="flex justify-between gap-4 py-3 text-sm"><span>{expense.name}</span><span>{money(expense.amount, profile.currency)}</span></div>)}</div> : <EmptyState>No budget categories configured.</EmptyState>}</PagePanel></Shell>;
  return <Shell active={section} title={title} description={descriptions[section]}><WeeklyBudget /><BudgetEngine /><div className="grid gap-4 md:grid-cols-2"><PagePanel><h2 className="text-lg font-semibold">Net worth history</h2><div className="mt-4"><EmptyState>Historical net-worth reporting will appear when compatible snapshots and balances are available.</EmptyState></div></PagePanel><PagePanel><h2 className="text-lg font-semibold">Cash flow trends</h2><div className="mt-4"><EmptyState>Historical cash-flow reporting is available from connected transactions when currencies are compatible.</EmptyState></div></PagePanel></div></Shell>;
}
