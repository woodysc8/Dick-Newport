import PlaidConnect from "./PlaidConnect";
import { institutionDisplayLabel } from "../../lib/dashboard";
import { redirect } from "next/navigation";
import { signOut } from "../auth/actions";
import { type DashboardAccount } from "../../lib/dashboard";
import { calculateFinancialPlanning } from "../../lib/financialPlanning";
import { STARTER_FINANCIAL_PROFILE, type FinancialProfile } from "../../lib/financialProfileDefaults";
import { normalizeFinancialProfile } from "../../lib/financialProfileNormalization";
import { createSupabaseServerClient, ensureOwnProfile } from "../../lib/supabase/server";
import FinanceNav from "./FinanceNav";

type Section = "Accounts" | "Paychecks" | "Debt" | "Goals" | "Reports";

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
      <div className="mb-5"><PlaidConnect /></div>
      <div className="grid gap-4 sm:grid-cols-3"><PagePanel><p className="text-sm text-[var(--text-muted)]">Connected accounts</p><p className="mt-2 text-3xl font-semibold">{rows.length}</p></PagePanel><PagePanel><p className="text-sm text-[var(--text-muted)]">Manual accounts</p><p className="mt-2 text-3xl font-semibold">{profile.financialAccounts?.length ?? 0}</p></PagePanel><PagePanel><p className="text-sm text-[var(--text-muted)]">Action</p><p className="mt-2 text-sm">Connect or refresh saved accounts using the control above.</p></PagePanel></div>
      <PagePanel><h2 className="text-lg font-semibold">Connected accounts</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Balances are actual imported observations. No currency conversion is applied.</p>{rows.length === 0 ? <div className="mt-5"><EmptyState>No connected accounts yet. Use the connection control above.</EmptyState></div> : <div className="mt-5 divide-y divide-[var(--border)]">{rows.map((account) => <div key={account.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-medium">{institutionDisplayLabel(account.institution_name)} · {account.account_name ?? "Unnamed account"}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{account.account_type ?? "Unknown type"} · {account.plaid_account_id ? "Plaid connected" : "Source unavailable"}</p></div><p className="font-semibold">{account.current_balance == null ? "Unknown" : money(Number(account.current_balance), account.currency ?? profile.currency)}</p></div>)}</div>}</PagePanel>
      <PagePanel><h2 className="text-lg font-semibold">Manual accounts</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Configured estimates are not treated as connected balances.</p>{profile.financialAccounts?.length ? <div className="mt-4 divide-y divide-[var(--border)]">{profile.financialAccounts.map((account, index) => <div key={`${account.name}-${index}`} className="flex justify-between gap-4 py-3 text-sm"><span>{account.name} · {account.accountType}</span><span>{account.balance == null ? "Unknown" : money(account.balance, account.currency ?? profile.currency)}</span></div>)}</div> : <div className="mt-4"><EmptyState>No manual accounts configured.</EmptyState></div>}</PagePanel>
    </Shell>;
  }

  const planning = calculateFinancialPlanning(profile);
  const title = section;
  const descriptions: Record<Section, string> = {
    Paychecks: "Keep income schedules, bills, savings allocations, and paycheck planning together.",
    Debt: "Track configured debt balances and payment obligations without mixing them with connected accounts.",
    Goals: "Set targets and dates without presenting allocations as actual account balances.",
    Reports: "A home for historical cash flow, spending, net worth, and investment reporting as data becomes available.",
    Accounts: "",
  };
  if (section === "Debt") return <Shell active={section} title={title} description={descriptions[section]}><PagePanel><h2 className="text-lg font-semibold">Debt obligations</h2>{profile.debts?.length ? <div className="mt-4 divide-y divide-[var(--border)]">{profile.debts.map((debt, index) => <div key={`${debt.name}-${index}`} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><div><p className="font-medium">{debt.name}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{debt.type ?? "Type not entered"} · minimum payment {debt.minimumPayment == null ? "unknown" : money(debt.minimumPayment, profile.currency)}</p></div><span className="font-semibold">{debt.balance == null ? "Unknown balance" : money(debt.balance, profile.currency)}</span></div>)}</div> : <EmptyState>No debt information configured.</EmptyState>}</PagePanel></Shell>;
  if (section === "Goals") return <Shell active={section} title={title} description={descriptions[section]}><PagePanel><h2 className="text-lg font-semibold">Financial goals</h2>{profile.goals?.length ? <div className="mt-4 divide-y divide-[var(--border)]">{profile.goals.map((goal, index) => <div key={`${goal.name}-${index}`} className="flex flex-wrap justify-between gap-3 py-3 text-sm"><span className="font-medium">{goal.name}</span><span>{goal.targetAmount == null ? "Target unknown" : money(goal.targetAmount, profile.currency)}{goal.targetDate ? ` · ${goal.targetDate}` : ""}</span></div>)}</div> : <EmptyState>No financial goals configured.</EmptyState>}<p className="mt-4 text-xs text-[var(--text-muted)]">Progress remains unavailable until a goal is explicitly linked to funding data.</p></PagePanel></Shell>;
  if (section === "Paychecks") return <Shell active={section} title={title} description={descriptions[section]}><PagePanel><h2 className="text-lg font-semibold">Income and paycheck plan</h2>{profile.incomeSources?.length ? <div className="mt-4 divide-y divide-[var(--border)]">{profile.incomeSources.map((source, index) => <div key={`${source.name}-${index}`} className="flex justify-between gap-4 py-3 text-sm"><span>{source.name} · {source.type}</span><span>{source.amount == null ? "Unknown" : money(source.amount, profile.currency)}{source.frequency ? ` / ${source.frequency}` : ""}</span></div>)}</div> : <EmptyState>No income sources configured. Add them in Financial profile.</EmptyState>}<div className="mt-6 grid gap-4 border-t border-[var(--border)] pt-5 sm:grid-cols-3"><div><p className="text-xs text-[var(--text-muted)]">Next paycheck</p><p className="mt-1 text-sm">Not configured</p></div><div><p className="text-xs text-[var(--text-muted)]">Expected take-home</p><p className="mt-1 text-sm">{planning.income.estimatedMonthlyTakeHomeIncome == null ? "Unknown" : money(planning.income.estimatedMonthlyTakeHomeIncome, profile.currency)} monthly</p></div><div><p className="text-xs text-[var(--text-muted)]">Planned savings</p><p className="mt-1 text-sm">{planning.savingsAllocations.monthlyAmount == null ? "Unknown" : money(planning.savingsAllocations.monthlyAmount, profile.currency)} monthly</p></div></div></PagePanel></Shell>;
  return <Shell active={section} title={title} description={descriptions[section]}><div className="grid gap-4 md:grid-cols-2"><PagePanel><h2 className="text-lg font-semibold">Net worth history</h2><div className="mt-4"><EmptyState>Historical net-worth reporting will appear when compatible snapshots and balances are available.</EmptyState></div></PagePanel><PagePanel><h2 className="text-lg font-semibold">Cash flow trends</h2><div className="mt-4"><EmptyState>Historical cash-flow reporting is available from connected transactions when currencies are compatible.</EmptyState></div></PagePanel></div></Shell>;
}
