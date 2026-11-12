"use client";
import { useEffect, useState } from "react";
import type { MonthlyActivityPage } from "../../lib/transactionData";
import { financeRequest, FinanceRequestError } from "../../lib/financeHttp";
import { institutionDisplayLabel } from "../../lib/dashboard";

function money(value: number | null, currency: string | null) {
  return value == null || !currency ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

export default function MonthlyTransactions({ initialQuery = "", preview = false }: { initialQuery?: string; preview?: boolean }) {
  const [query, setQuery] = useState(initialQuery);
  const [month, setMonth] = useState(new URLSearchParams(initialQuery).get("month") ?? "");
  const [account, setAccount] = useState(new URLSearchParams(initialQuery).get("account") ?? "");
  const [data, setData] = useState<MonthlyActivityPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void financeRequest<MonthlyActivityPage>(`/api/transactions?view=monthly&${query}`, { signal: controller.signal })
      .then((result) => {
        if (!Array.isArray(result.rows) || !Array.isArray(result.accounts) || !Number.isInteger(result.totalTransactions) || !/^\d{4}-\d{2}$/.test(result.month) || !Number.isInteger(result.page) || typeof result.hasMore !== "boolean")
          throw new Error("Invalid monthly activity response");
        if (!controller.signal.aborted) {
          setData(result); setMonth(result.month); setAccount(result.selectedAccountId ?? ""); setError("");
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(failure instanceof FinanceRequestError ? failure.message : "Monthly activity is unavailable. Retry before relying on a spending total.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, revision]);
  useEffect(() => {
    const refresh = () => { setLoading(true); setRevision((v) => v + 1); };
    window.addEventListener("financial-data-refreshed", refresh);
    window.addEventListener("transaction-preferences-updated", refresh);
    return () => {
      window.removeEventListener("financial-data-refreshed", refresh);
      window.removeEventListener("transaction-preferences-updated", refresh);
    };
  }, []);
  const paginate = (page: number) => {
    const params = new URLSearchParams(query);
    params.set("month", data!.month); params.set("page", String(page));
    setLoading(true); setQuery(params.toString());
  };
  return <section aria-label={preview ? "Monthly spending and recent transactions" : "Monthly transactions"} className="space-y-5">
    {!preview && <form className="flex flex-wrap items-end gap-4" onSubmit={(e) => {
      e.preventDefault();
      const params = new URLSearchParams({ month });
      if (account) params.set("account", account);
      setLoading(true); setError(""); setQuery(params.toString()); setRevision((v) => v + 1);
    }}>
      <label className="text-sm">Month<input type="month" required min="1000-01" max="9998-12" value={month} disabled={loading} onChange={(e) => setMonth(e.target.value)} className="mt-1 block rounded border border-[var(--border)] p-2" /></label>
      <label className="text-sm">Account<select value={account} disabled={loading} onChange={(e) => setAccount(e.target.value)} className="mt-1 block rounded border border-[var(--border)] p-2">
        <option value="">All accounts</option>
        {data?.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {institutionDisplayLabel(a.institution)}</option>)}
      </select></label>
      <button disabled={loading} className="rounded border border-[var(--border)] px-4 py-2 text-sm">Show transactions</button>
    </form>}
    {loading && <p role="status">Loading monthly activity…</p>}
    {error && <p role="alert">{error} <button className="underline" onClick={() => { setLoading(true); setRevision((v) => v + 1); }}>Retry</button></p>}
    {!loading && data && <>
      <div className="finance-panel grid gap-5 rounded-2xl border border-[var(--border)] p-5 sm:grid-cols-2">
        <div><h2 className="text-sm text-[var(--text-muted)]">Posted purchases · {data.month}</h2><p className="mt-2 text-3xl font-semibold">{money(data.postedPurchases, data.currency)}</p><p className="mt-1 text-sm">Provisional · includes unverified posted debits</p></div>
        <div><h2 className="text-sm text-[var(--text-muted)]">Transactions this month</h2><p className="mt-2 text-3xl font-semibold">{data.totalTransactions}</p><p className="mt-1 text-sm">Posted and pending activity after duplicate removal</p></div>
      </div>
      <p className="text-sm text-[var(--text-muted)]">Recorded activity for the selected calendar month in America/New_York. Incoming money, refunds and verified movements are not new purchases. Pending purchases are separate. A successful read does not verify sync freshness or complete history.</p>
      <details className="rounded border border-[var(--border)] p-3 text-sm">
        <summary className="cursor-pointer">Spending breakdown</summary>
        <p className="mt-2">Confirmed purchase subtotal: {money(data.confirmedPurchases, data.currency)}. Unverified posted debits included: {money(data.unverifiedDebits, data.currency)}. This includes ambiguous Venmo payments and other outflows whose purpose is uncertain.</p>
        <p className="mt-2">Pending purchases, excluded from posted total: {money(data.pendingPurchases, data.currency)}. Verified movements excluded: {money(data.excludedMovements, data.currency)}. Refunds and incoming money are not subtracted from purchases.</p>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">{([
          ["Posted credit-card payments excluded", data.movementBreakdown.cardPayments],
          ["Posted investment transfers excluded", data.movementBreakdown.investmentTransfers],
          ["Posted internal transfers excluded", data.movementBreakdown.internalTransfers],
          ["Other posted verified movements excluded", data.movementBreakdown.other],
        ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{money(value, data.currency)}</dd></div>)}</dl>
        <p className="mt-2">Movement exclusions use saved overrides, reliable modern metadata, or narrowly corroborated legacy payment/funding evidence. A merchant name or Venmo label alone never excludes a debit.</p>
        <p className="mt-2">{data.unknownAmountCount} amounts unavailable · {data.unknownStatusCount} posting statuses unknown · {data.omittedDuplicates} duplicate or replaced records omitted.</p>
        {data.repeatedSources > 0 && <p className="mt-2">Repeated account connections are grouped. Records with distinct provider identities remain visible; unresolved overlapping histories make the combined spending figure unavailable rather than double-counting purchases.</p>}
        {data.postedPurchases == null && <p className="mt-2">A combined spending figure is unavailable because amounts, posting statuses or currencies are missing or incompatible, or repeated sources cannot be reconciled. No currency conversion or partial total is presented.</p>}
      </details>
      {preview && <h2 className="text-xl font-semibold">Recent transactions</h2>}
      <div className="finance-panel overflow-x-auto rounded-2xl border border-[var(--border)]">
        <table className="w-full text-left text-sm"><caption className="sr-only">Transactions for {data.month}, newest first</caption>
          <thead><tr>{["Date", "Merchant", "Amount", "Account"].map((label) => <th key={label} className="border-b border-[var(--border)] p-4 font-medium">{label}</th>)}</tr></thead>
          <tbody>{(preview ? data.rows.slice(0, 6) : data.rows).map((t) => <tr key={t.id} className="border-b border-[var(--border)] last:border-0">
            <td className="p-4 whitespace-nowrap">{t.date}<span className="mt-1 block text-xs text-[var(--text-muted)]">{t.pending == null ? "Status unknown" : t.pending ? "Pending" : "Posted"}</span></td>
            <td className="p-4"><span className="font-medium">{t.merchant}</span>{t.purpose === "unverified" && t.amount != null && t.amount > 0 && <span className="mt-1 block text-xs text-[var(--text-muted)]">Unverified debit</span>}{t.purpose === "movement" && <span title={t.purposeReason ?? undefined} className="mt-1 block text-xs text-[var(--text-muted)]">Supported movement</span>}</td>
            <td className="p-4 whitespace-nowrap">{t.amount == null ? "Amount unavailable" : t.currency ? `${t.amount < 0 ? "+" : "−"}${money(Math.abs(t.amount), t.currency)}` : `${t.amount < 0 ? "+" : "−"}${Math.abs(t.amount).toFixed(2)} · currency unknown`}</td>
            <td className="p-4">{t.account}<span className="mt-1 block text-xs text-[var(--text-muted)]">{institutionDisplayLabel(t.institution)}</span></td>
          </tr>)}</tbody>
        </table>
        {data.rows.length === 0 && <p className="p-5 text-sm">No recorded transactions for this month and account.</p>}
      </div>
      {preview ? <a href="/transactions" className="inline-block text-sm underline">View all transactions</a> : <div className="flex items-center gap-4 text-sm"><button disabled={data.page <= 1} onClick={() => paginate(data.page - 1)} className="rounded border px-3 py-2 disabled:opacity-40">Previous</button><span>Page {data.page}</span><button disabled={!data.hasMore} onClick={() => paginate(data.page + 1)} className="rounded border px-3 py-2 disabled:opacity-40">Next</button></div>}
    </>}
  </section>;
}
