"use client";
import { useEffect, useState } from "react";
import { categories } from "../../lib/discretionaryBudget";
import { suggestionConfidences } from "../../lib/transactionClassification";
import type { TransactionSuggestionsPage } from "../../lib/transactionData";
import { financeRequest } from "../../lib/financeHttp";
import { transactionAmount } from "./TransactionsWorkspace";

const confidenceLabel = (value: string) => value === "needs_review" ? "Needs review" : value;
const evidenceLabels = {
  user_override: "User override", modern_plaid: "Modern Plaid category",
  legacy_plaid: "Legacy Plaid category", merchant_rule: "Narrow merchant rule",
  insufficient_evidence: "Insufficient evidence",
};

export default function SuggestedClassifications() {
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<TransactionSuggestionsPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void financeRequest<TransactionSuggestionsPage>(`/api/transactions?view=suggestions&${query}`, { signal: controller.signal })
      .then((result) => {
        if (!Array.isArray(result.suggestions) || !Array.isArray(result.accounts) || !result.summary || !Number.isInteger(result.page) || typeof result.hasMore !== "boolean")
          throw new Error("Invalid suggestion response");
        if (!controller.signal.aborted) { setData(result); setError(""); }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setData(null);
          setError("Suggestions unavailable. No records changed. Retry; account, budget policy or transaction reads may be unavailable.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, revision]);
  useEffect(() => {
    const refresh = () => { setLoading(true); setRevision((v) => v + 1); };
    window.addEventListener("transaction-preferences-updated", refresh);
    window.addEventListener("financial-data-refreshed", refresh);
    return () => {
      window.removeEventListener("transaction-preferences-updated", refresh);
      window.removeEventListener("financial-data-refreshed", refresh);
    };
  }, []);
  const paginate = (page: number) => {
    const params = new URLSearchParams(query);
    params.set("page", String(page));
    setLoading(true); setQuery(params.toString());
  };
  return (
    <section aria-label="Suggested classifications" className="my-5 rounded-2xl border border-[var(--border)] p-5">
      <h2 className="text-xl font-semibold">Suggested classifications</h2>
      <p className="mt-2 text-sm">Read-only suggestions. Viewing or filtering changes no records or budget totals. To save a correction, use the existing classification review or transaction browser below. No bulk approval is provided here.</p>
      <p className="mt-2 text-sm text-[var(--text-muted)]">A successful read does not verify Plaid freshness. Missing provider metadata means incomplete modern Plaid category/confidence fields; legacy text may still be present.</p>
      <form className="my-4 flex flex-wrap items-end gap-3" onSubmit={(e) => {
        e.preventDefault();
        const params = new URLSearchParams();
        for (const [key, value] of new FormData(e.currentTarget)) if (typeof value === "string" && value) params.set(key, value);
        setLoading(true); setError(""); setQuery(params.toString()); setRevision((v) => v + 1);
      }}>
        <label>Suggestion confidence<select name="suggestion_confidence" className="ml-2 rounded border p-2">
          <option value="">All confidence levels</option>
          {suggestionConfidences.map((c) => <option key={c} value={c}>{confidenceLabel(c)}</option>)}
        </select></label>
        <label>Proposed category<select name="proposed_category" className="ml-2 rounded border p-2">
          <option value="">All proposed categories</option>
          {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        <label>Suggestion account<select name="account" className="ml-2 rounded border p-2">
          <option value="">All accounts</option>
          {data?.accounts.map((a, index) => <option key={a.id} value={a.id}>{a.account_name} · Source {index + 1}</option>)}
        </select></label>
        <label>Current review status<select name="review_status" className="ml-2 rounded border p-2">
          <option value="">All review statuses</option><option value="reviewed">Has manual category override</option><option value="unreviewed">No manual category override</option>
        </select></label>
        <button disabled={loading} className="rounded border p-2">Filter suggestions</button>
      </form>
      {loading && <p role="status">Loading suggestions…</p>}
      {error && <p role="alert">{error} <button className="underline" onClick={() => { setLoading(true); setRevision((v) => v + 1); }}>Retry suggestions</button></p>}
      {!loading && data && <>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          {([
            ["Total transactions", data.summary.total], ["Already reviewed", data.summary.alreadyReviewed],
            ["High-confidence suggestions", data.summary.high], ["Medium-confidence suggestions", data.summary.medium],
            ["Still ambiguous", data.summary.ambiguous], ["Missing provider metadata", data.summary.missingProviderMetadata],
          ] as const).map(([label, count]) => <div key={label}><dt>{label}</dt><dd className="font-semibold">{count}</dd></div>)}
        </dl>
        <p className="mt-3 text-sm">Counts cover all imported rows in the selected account scope, before confidence/category/review filters. Already reviewed means a manual category override. Low-confidence candidates remain ambiguous. Pending replacements and duplicate rows remain visible; these counts are not spending totals.</p>
        <p className="mt-2 text-sm">{data.matching} matching rows · page {data.page} · up to 50 per page</p>
        {data.suggestions.length === 0 && <p className="mt-3">No suggestions match these filters.</p>}
        <div className="mt-3 space-y-3">
          {data.suggestions.map(({ transaction: t, suggestion: s, weekly, monthly }) => <article key={t.id} className="rounded border border-[var(--border)] p-3 text-sm">
            <h3 className="font-semibold">{t.merchant_name || t.name}</h3>
            <p>{t.date} · {transactionAmount(t, data.accounts)} · {t.pending == null ? "Status unknown" : t.pending ? "Pending" : "Posted"} · {data.accounts.find((a) => a.id === t.account_id)?.account_name ?? "Account unavailable"}</p>
            <p>Stored category: {t.normalized_category ? categories[t.normalized_category] : "Unavailable"} · Manual category: {t.category_override ? categories[t.category_override] : "None"} · Legacy provider text: {Array.isArray(t.category) ? t.category.join(" > ") : t.category || "Unavailable"}</p>
            <p>Suggested category: <strong>{categories[s.category]}</strong> · {confidenceLabel(s.confidence)} · {evidenceLabels[s.evidence]}</p>
            <p>{s.reason}</p>
            {s.movementRisk && <p>Financial-movement risk: {s.movementRisk}</p>}
            <p>Weekly category default: {s.weeklyIncludedByDefault == null ? "Unresolved" : s.weeklyIncludedByDefault ? "Included" : "Excluded"}. {s.requiresApproval ? "Explicit approval required; nothing saved." : "Existing manual category preserved."}</p>
            <details className="mt-2"><summary className="cursor-pointer">Spending effect if explicitly approved</summary>
              <p>Weekly: {weekly.kind} · {weekly.reason}</p><p>Monthly: {monthly.kind} · {monthly.reason}</p>
              <p>Hypothetical decision using current source, currency and inclusion rules. Pending purchases remain projected; credits require review. No dollar totals are recalculated by this preview.</p>
            </details>
          </article>)}
        </div>
        <div className="mt-4 flex gap-4">
          <button className="rounded border p-2" disabled={data.page <= 1} onClick={() => paginate(data.page - 1)}>Previous suggestions</button>
          <button className="rounded border p-2" disabled={!data.hasMore || data.page >= 1000} onClick={() => paginate(data.page + 1)}>Next suggestions</button>
        </div>
      </>}
    </section>
  );
}
