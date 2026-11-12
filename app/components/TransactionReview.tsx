"use client";
import { useRef, useState } from "react";
import { categories } from "../../lib/discretionaryBudget";
import { financeRequest, jsonMutation } from "../../lib/financeHttp";
type Preview = {
  before: Record<string, number>;
  after: Record<string, number>;
  scope: string;
  examples: {
    id: string;
    name: string;
    date: string;
    before: string;
    after: string;
    source: string;
    reason: string;
  }[];
};
export default function TransactionReview() {
  const [preview, setPreview] = useState<Preview | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const lock = useRef(false);
  async function load() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const data = await financeRequest<Preview>("/api/transactions/review");
      if (
        !Array.isArray(data.examples) ||
        !data.before ||
        !data.after ||
        typeof data.scope !== "string"
      )
        throw new Error();
      setPreview(data);
      setSelected([]);
      setConfirmed(false);
    } catch {
      setError(
        "Review preview unavailable. No transactions were changed; check migration readiness.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="my-5 rounded-2xl border border-[var(--border)] p-5"
      aria-label="Classification review"
    >
      <h2 className="font-semibold">Classification review and dry run</h2>
      <p className="mt-2 text-sm">
        Preview automatic classifications without changing records. Corrections
        apply only to explicitly selected transactions, never to an inferred
        merchant-wide rule.
      </p>
      <button
        className="mt-3 rounded border p-2"
        disabled={busy}
        onClick={() => void load()}
      >
        Preview reclassification (no writes)
      </button>{" "}
      <a
        href="/transactions?category=needs_review"
        className="text-sm underline"
      >
        Filter stored Needs review
      </a>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {preview && (
        <>
          <p className="mt-3 text-sm">{preview.scope}</p>
          <details className="mt-3">
            <summary>Before / after counts</summary>
            <pre className="overflow-auto text-xs">
              {JSON.stringify(
                { before: preview.before, after: preview.after },
                null,
                2,
              )}
            </pre>
          </details>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (lock.current || !confirmed) return;
              lock.current = true;
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                await financeRequest(
                  "/api/transactions/review",
                  jsonMutation("POST", {
                    ids: selected,
                    category: f.get("category"),
                    weekly: f.get("weekly"),
                    monthly: f.get("monthly"),
                    confirmed,
                  }),
                );
                setNotice(
                  "Selected corrections saved with an audit entry. The transaction list is refreshing.",
                );
                setPreview(null);
                setSelected([]);
                setConfirmed(false);
                window.dispatchEvent(new Event("weekly-budget-updated"));
                window.dispatchEvent(
                  new Event("transaction-preferences-updated"),
                );
              } catch {
                setError(
                  "Nothing could be confirmed. Refresh the preview and check ownership before retrying.",
                );
              } finally {
                lock.current = false;
                setBusy(false);
              }
            }}
          >
            <div className="mt-3 max-h-96 space-y-2 overflow-auto">
              {preview.examples.map((t) => (
                <label key={t.id} className="block rounded border p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(t.id)}
                    onChange={(e) => {
                      setSelected((ids) =>
                        e.target.checked
                          ? [...ids, t.id]
                          : ids.filter((id) => id !== t.id),
                      );
                      setConfirmed(false);
                    }}
                  />{" "}
                  {t.date} · {t.name} · {t.before} → {t.after}
                  <span className="block">
                    {t.source}: {t.reason}
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3">
              <label>
                Correction
                <select name="category" className="ml-2 border p-2">
                  {Object.entries(categories).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {["weekly", "monthly"].map((period) => (
                <label key={period}>
                  {period}
                  <select name={period} className="ml-2 border p-2">
                    <option value="default">Use category/account rule</option>
                    <option value="include">Include</option>
                    <option value="exclude">Exclude</option>
                  </select>
                </label>
              ))}
            </div>
            <label className="mt-3 block text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />{" "}
              Confirm correction of {selected.length} selected transactions,
              replacing their current category and weekly/monthly overrides.
            </label>
            <button
              disabled={busy || !confirmed || !selected.length}
              className="mt-3 rounded border p-2"
            >
              Save selected corrections
            </button>
          </form>
        </>
      )}
    </section>
  );
}
