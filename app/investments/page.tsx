import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthenticatedSupabaseContext } from "../../lib/supabase/server";
import { loadConnectedPosition, summarizeConnectedPosition } from "../../lib/connectedPosition";
import { getDashboardAccountClass, type InvestmentHolding } from "../../lib/dashboard";
import { Shell, PagePanel } from "../components/FinancePage";

const numeric = (value: number | string | null | undefined) => value == null || String(value).trim() === "" || !Number.isFinite(Number(value)) ? null : Number(value);
function money(value: number | string | null | undefined, currency: string | null | undefined) {
  const amount = numeric(value);
  return amount == null || !currency || !/^[A-Z]{3}$/.test(currency) ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

export default async function InvestmentsPage() {
  const context = await getAuthenticatedSupabaseContext();
  if (!context) redirect("/login");
  const [position, result] = await Promise.all([
    loadConnectedPosition(context.supabase, context.user.id).catch(() => null),
    context.supabase.from("investment_holdings")
      .select("id, plaid_account_id, security_name, ticker_symbol, quantity, institution_value, institution_price, cost_basis, currency, iso_currency_code", { count: "exact" })
      .eq("user_id", context.user.id).order("institution_value", { ascending: false }).limit(501),
  ]);
  const accounts = position?.accounts.filter((a) => ["investment", "retirement"].includes(getDashboardAccountClass(a))) ?? [];
  const summary = summarizeConnectedPosition(accounts).summary;
  const holdings = !result.error && result.count != null && result.count <= 500 && result.data?.length === result.count ? result.data as InvestmentHolding[] : null;
  return <Shell active="Investments" title="Investments" description="Connected account balances and stored security positions.">
    <PagePanel>
      <h2 className="text-sm text-[var(--text-muted)]">Connected investment account balances</h2>
      <p className="mt-2 text-3xl font-semibold">{position && accounts.length ? money(summary.netWorth, summary.currency) : "Unavailable"}</p>
      {!position && <p role="alert" className="mt-3 text-sm">Investment account balances could not be loaded.</p>}
      <p className="mt-3 text-sm text-[var(--text-muted)]">Account balances already include their holdings and cash. The positions below are a separate view, not extra assets. Prices and balances are recorded snapshots; freshness is unverified.</p>
      <div className="mt-4 divide-y divide-[var(--border)]">{accounts.map((a) => <div key={a.id} className="flex justify-between gap-4 py-3 text-sm"><span>{a.account_name ?? "Investment account"} · {a.account_subtype ?? "Type unavailable"}</span><span>{money(a.current_balance, a.currency)}</span></div>)}</div>
    </PagePanel>
    <div className="mt-5"><PagePanel>
      <h2 className="text-xl font-semibold">Holdings</h2>
      {holdings == null ? <p role="alert" className="mt-3">Holdings could not be loaded completely. Missing data is not a zero-value portfolio.</p> : holdings.length === 0 ? <p className="mt-3 text-sm">{accounts.length ? "Investment balances connected. Individual holdings are not yet available." : "No stored investment holdings are available."}</p> : <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-sm"><caption className="sr-only">Stored investment holdings</caption><thead><tr>{["Security", "Ticker", "Quantity", "Current value", "Price", "Cost basis"].map((label) => <th key={label} className="border-b border-[var(--border)] p-3">{label}</th>)}</tr></thead>
          <tbody>{holdings.map((h) => {
            const account = position?.accounts.find((a) => a.plaid_account_id === h.plaid_account_id);
            const currency = h.currency ?? h.iso_currency_code ?? account?.currency;
            const quantity = numeric(h.quantity);
            return <tr key={h.id} className="border-b border-[var(--border)]"><td className="p-3">{h.security_name ?? "Unnamed security"}<small className="mt-1 block text-[var(--text-muted)]">{account?.account_name ?? "Account unavailable"}</small></td><td className="p-3">{h.ticker_symbol ?? "Unavailable"}</td><td className="p-3">{quantity == null ? "Unavailable" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(quantity)}</td><td className="p-3">{money(h.institution_value, currency)}</td><td className="p-3">{money(h.institution_price, currency)}</td><td className="p-3">{money(h.cost_basis, currency)}</td></tr>;
          })}</tbody>
        </table>
      </div>}
    </PagePanel></div>
    <div className="mt-5"><PagePanel><h2 className="text-xl font-semibold">Purchase history</h2><p className="mt-3">Purchase history unavailable</p><p className="mt-2 text-sm text-[var(--text-muted)]">Security trade history and acquisition dates are not stored. Account creation dates, balance snapshots and holding update times are not purchase dates.</p></PagePanel></div>
    <div className="mt-5 flex gap-5 text-sm"><Link href="/" className="underline">Overview</Link><a href="/transactions" className="underline">View transactions</a></div>
  </Shell>;
}
