import { redirect } from "next/navigation";
import { getAuthenticatedSupabaseContext } from "../lib/supabase/server";
import { loadConnectedPosition } from "../lib/connectedPosition";
import { institutionDisplayLabel } from "../lib/dashboard";
import { Shell, PagePanel } from "./components/FinancePage";
import MonthlyTransactions from "./components/MonthlyTransactions";

export default async function Home() {
  const context = await getAuthenticatedSupabaseContext();
  if (!context) redirect("/login");
  const position = await loadConnectedPosition(context.supabase, context.user.id).catch(() => null);
  const money = (value: number | string | null, currency?: string | null) => value == null || !currency || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(Number(value))
    ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value));
  return <Shell active="Overview" title="Overview" description="Your connected financial position and recent spending.">
    {!position && <p role="alert" className="mb-5">Connected balances could not be loaded. Net worth is unavailable; retry before relying on these figures.</p>}
    <PagePanel>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{([
        ["Net worth", position?.summary.netWorth], ["Cash", position?.summary.cash],
        ["Investment balances", position?.summary.investments],
        ...((position?.summary.crypto ?? 0) !== 0 ? [["Crypto assets", position?.summary.crypto] as const] : []),
        ["Liabilities", position?.summary.credit],
      ] as const).map(([label, value]) => <div key={label}><h2 className="text-sm text-[var(--text-muted)]">{label}</h2><p className="mt-2 text-2xl font-semibold">{position?.summary.configured ? money(value ?? null, position.summary.currency) : "Unavailable"}</p></div>)}</div>
      <p className="mt-4 text-sm text-[var(--text-muted)]">Connected account balances only: assets minus liabilities. Holdings and manual estimates are not added again. Recorded balances may be stale; coverage and freshness are unverified.</p>
      {position?.duplicatesOmitted ? <p className="mt-2 text-sm">{position.duplicatesOmitted} repeated account records omitted using stored identities.</p> : null}
      <div className="mt-5 divide-y divide-[var(--border)]">{position?.accounts.map((a) => <div key={a.id} className="flex justify-between gap-4 py-3 text-sm"><div><p>{a.account_name ?? "Unnamed account"}</p><p className="mt-1 text-xs text-[var(--text-muted)]">{institutionDisplayLabel(a.institution_name)} · {a.account_subtype ?? a.account_type ?? "Type unavailable"}</p></div><span>{money(a.current_balance, a.currency)}</span></div>)}</div>
      <div className="mt-4 flex gap-5 text-sm"><a href="/accounts" className="underline">View accounts</a><a href="/investments" className="underline">View investments</a><a href="/transactions" className="underline">View transactions</a></div>
    </PagePanel>
    <div className="mt-8"><MonthlyTransactions preview /></div>
  </Shell>;
}
