import { redirect } from "next/navigation";
import Link from "next/link";
import { getAuthenticatedSupabaseContext } from "../../lib/supabase/server";
import { loadConnectedPosition, summarizeConnectedPosition } from "../../lib/connectedPosition";
import { getDashboardAccountClass, type InvestmentHolding } from "../../lib/dashboard";
import { loadInvestmentHoldingState, holdingStatusMessage } from "../../lib/investmentHoldingState";
import { holdingNumber, holdingPrice, unrealizedHoldingReturn } from "../../lib/investmentHoldingMetrics";
import { Shell, PagePanel } from "../components/FinancePage";
import InvestmentHoldingsControls from "../components/InvestmentHoldingsControls";

function money(value: unknown, currency: string | null | undefined) {
  const amount = holdingNumber(value);
  return amount == null || !currency || !/^[A-Z]{3}$/.test(currency) ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}
export default async function InvestmentsPage() {
  const context = await getAuthenticatedSupabaseContext();
  if (!context) redirect("/login");
  const [position, result, state] = await Promise.all([
    loadConnectedPosition(context.supabase, context.user.id).catch(() => null),
    context.supabase.from("investment_holdings")
      .select("id, plaid_account_id, security_name, ticker_symbol, quantity, institution_value, institution_price, cost_basis, currency, iso_currency_code", { count: "exact" })
      .eq("user_id", context.user.id).order("institution_value", { ascending: false }).limit(501),
    loadInvestmentHoldingState(context.supabase, context.user.id).catch(() => null),
  ]);
  const accounts = position?.accounts.filter((a) => ["investment", "retirement"].includes(getDashboardAccountClass(a)) || a.account_type === "crypto") ?? [];
  const summary = summarizeConnectedPosition(accounts).summary;
  const holdings = !result.error && result.count != null && result.count <= 500 && result.data?.length === result.count ? result.data as InvestmentHolding[] : null;
  const sourceAccounts = state?.accounts ?? accounts;
  const groups = sourceAccounts.filter((a) => a.plaid_account_id).map((a) => ({ name: a.account_name ?? "Investment account", accountId: a.plaid_account_id, status: "holdings_status" in a ? String(a.holdings_status) : undefined, syncedAt: "holdings_synced_at" in a ? a.holdings_synced_at as string | null : null }));
  if (holdings?.some((h) => !h.plaid_account_id || !sourceAccounts.some((a) => a.plaid_account_id === h.plaid_account_id))) groups.push({ name: "Account association unavailable", accountId: null, status: "error", syncedAt: null });
  return <Shell active="Investments" title="Investments" description="Connected account balances and stored security positions.">
    <InvestmentHoldingsControls />
    <PagePanel>
      <h2 className="text-sm text-[var(--text-muted)]">Connected investment account balances</h2>
      <p className="mt-2 text-3xl font-semibold">{position && accounts.length ? money(summary.netWorth, summary.currency) : "Unavailable"}</p>
      {!position && <p role="alert" className="mt-3 text-sm">Investment account balances could not be loaded.</p>}
      {position?.unresolvedInvestmentOverlap && <p className="mt-3 text-sm">Investment connections may overlap without verified durable account identities. A combined investment balance and net worth are unavailable to prevent double-counting.</p>}
      <p className="mt-3 text-sm text-[var(--text-muted)]">Account balances already include their holdings and cash. Positions below are a separate view, not extra assets. Prices and balances are recorded snapshots; freshness is unverified.</p>
      <div className="mt-4 divide-y divide-[var(--border)]">{accounts.map((a) => <div key={a.id} className="flex justify-between gap-4 py-3 text-sm"><span>{a.account_name ?? "Investment account"} · {a.account_subtype ?? "Type unavailable"}</span><span>{money(a.current_balance, a.currency)}</span></div>)}</div>
    </PagePanel>
    <div className="mt-5"><PagePanel>
      <h2 className="text-xl font-semibold">Holdings by account</h2>
      {!state && <p className="mt-3 text-sm">Per-account holdings status unavailable. Stored positions may be stale.</p>}
      {holdings == null ? <p role="alert" className="mt-3">Holdings could not be loaded completely. Missing data is not a zero-value portfolio.</p> : <>
        {holdings.length === 0 && <p className="mt-3 text-sm">{state?.accounts.some((a) => a.holdings_status === "empty") ? "No stored positions. Account status below identifies explicitly empty responses and other data gaps." : accounts.length ? "Investment balances connected. Individual holdings are not yet available." : "No stored investment holdings are available."}</p>}
        {groups.map((group, index) => {
          const rows = holdings.filter((h) => group.accountId ? h.plaid_account_id === group.accountId : !h.plaid_account_id || !sourceAccounts.some((a) => a.plaid_account_id === h.plaid_account_id));
          return <section key={index} className="mt-6"><h3 className="font-semibold">{group.name}</h3><p className="mt-2 text-xs text-[var(--text-muted)]">{holdingStatusMessage(group.status, group.syncedAt)}</p>{rows.length > 0 && <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm"><caption className="sr-only">Stored holdings for {group.name}</caption><thead><tr>{["Security", "Ticker", "Quantity", "Current value", "Price", "Cost basis", "Unrealized gain/loss"].map((label) => <th key={label} className="border-b border-[var(--border)] p-3">{label}</th>)}</tr></thead>
              <tbody>{rows.map((h) => {
                const currency = h.currency ?? h.iso_currency_code;
                const quantity = holdingNumber(h.quantity), gain = unrealizedHoldingReturn(h.institution_value, h.cost_basis, h.quantity);
                return <tr key={h.id} className="border-b border-[var(--border)]"><td className="p-3">{h.security_name ?? "Unnamed security"}</td><td className="p-3">{h.ticker_symbol ?? "Unavailable"}</td><td className="p-3">{quantity == null ? "Unavailable" : new Intl.NumberFormat("en-US", { maximumSignificantDigits: 15 }).format(quantity)}</td><td className="p-3">{money(h.institution_value, currency)}</td><td className="p-3">{holdingPrice(h.institution_price, currency)}</td><td className="p-3">{money(h.cost_basis, currency)}</td><td className="p-3">{money(gain.amount, currency)}{gain.percent != null && currency ? <small className="block">{gain.percent.toFixed(2)}%</small> : null}</td></tr>;
              })}</tbody>
            </table>
          </div>}</section>;
        })}
        <p className="mt-4 text-xs text-[var(--text-muted)]">Unrealized gain/loss is market value minus the total recorded cost basis in the holding currency. It is unavailable for missing or unsupported signed positions. It is not total investment performance. No prices or purchase dates are inferred.</p>
      </>}
    </PagePanel></div>
    <div className="mt-5"><PagePanel><h2 className="text-xl font-semibold">Purchase history</h2><p className="mt-3">Purchase history unavailable</p><p className="mt-2 text-sm text-[var(--text-muted)]">Security trade history and acquisition dates are not stored. Account creation dates, balance snapshots and holding update times are not purchase dates.</p></PagePanel></div>
    <div className="mt-5 flex gap-5 text-sm"><Link href="/" className="underline">Overview</Link><a href="/transactions" className="underline">View transactions</a><Link href="/reports" className="underline">Financial Report</Link></div>
  </Shell>;
}
