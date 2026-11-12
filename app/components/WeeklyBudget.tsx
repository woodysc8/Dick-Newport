"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  accountSources,
  addDays,
  categories,
  weekPeriod,
  type BudgetAccount,
  type weeklyMetrics,
} from "../../lib/discretionaryBudget";
import {
  FinanceRequestError,
  financeRequest,
  jsonMutation,
} from "../../lib/financeHttp";

type WeeklyData = {
  metrics: ReturnType<typeof weeklyMetrics>;
  accounts: BudgetAccount[];
  freshness?: { lastSyncAt: string | null };
};
const dollars = (value: number | null) =>
  value == null
    ? "Not set"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(value);

export default function WeeklyBudget({
  editable = false,
  sourcesOnly = false,
}: {
  editable?: boolean;
  sourcesOnly?: boolean;
}) {
  const [data, setData] = useState<WeeklyData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const requestSequence = useRef(0);
  const load = useCallback((signal?: AbortSignal) => {
    const sequence = ++requestSequence.current;
    return financeRequest<WeeklyData>("/api/weekly-budget", { signal })
      .then((result) => {
        if (!result.metrics || !Array.isArray(result.accounts))
          throw new Error();
        if (signal?.aborted || sequence !== requestSequence.current) return;
        setData(result);
        setLimit(
          result.metrics.limit == null ? "" : String(result.metrics.limit),
        );
        setError(null);
      })
      .catch((error) => {
        if (!signal?.aborted && sequence === requestSequence.current) {
          setData(null);
          setError(
            `Weekly spending is unavailable. ${error instanceof FinanceRequestError ? error.message : "Retry; the administrator may need to deploy the weekly budget migration."}`,
          );
        }
      })
      .finally(() => {
        if (!signal?.aborted && sequence === requestSequence.current)
          setLoading(false);
      });
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  useEffect(() => {
    let date = weekPeriod().today;
    const checkDate = () => {
      const next = weekPeriod().today;
      if (next !== date) {
        date = next;
        setLoading(true);
        void load();
      }
    };
    const timer = window.setInterval(checkDate, 60000);
    window.addEventListener("focus", checkDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkDate);
    };
  }, [load]);
  useEffect(() => {
    const update = () => {
      setLoading(true);
      void load();
    };
    window.addEventListener("weekly-budget-updated", update);
    window.addEventListener("financial-data-refreshed", update);
    return () => {
      window.removeEventListener("weekly-budget-updated", update);
      window.removeEventListener("financial-data-refreshed", update);
    };
  }, [load]);
  const mutate = async (method: string, body: unknown) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      await financeRequest("/api/weekly-budget", jsonMutation(method, body));
      setNotice("Weekly budget preferences saved.");
      await load();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Unable to save weekly budget preferences.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const m = data?.metrics;
  return (
    <section
      id={editable ? "weekly-spending" : undefined}
      className="finance-panel my-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 sm:p-6"
      aria-label={
        sourcesOnly
          ? "Weekly budget account sources"
          : "Weekly discretionary budget"
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-[var(--accent)]">
            {sourcesOnly ? "Account sources" : "Weekly spending"}
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            {sourcesOnly
              ? "Choose one connection per account"
              : "Weekly discretionary budget"}
          </h2>
        </div>
        {!editable && (
          <a href="/budget#weekly-spending" className="text-sm underline">
            {m?.limit == null ? "Set budget" : "Edit budget"}
          </a>
        )}
      </div>
      {loading && (
        <p role="status" className="mt-4 animate-pulse text-sm">
          Loading weekly spending...
        </p>
      )}
      {error && (
        <div role="alert" className="mt-4 text-sm text-red-700">
          {error}{" "}
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => {
              setLoading(true);
              void load();
            }}
            className="underline"
          >
            Retry
          </button>
        </div>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm">
          {notice}
        </p>
      )}
      {!loading && m && !sourcesOnly && (
        <>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            {m.start} – {addDays(m.end, -1)} · Monday–Sunday · America/New_York
            · USD
          </p>
          <p className="mt-2 text-sm">
            Last recorded complete sync:{" "}
            {data?.freshness?.lastSyncAt ??
              "Not recorded; freshness is unverified"}
            . Confirm source coverage and review warnings before relying on
            totals.
          </p>
          {(m.reviewCount > 0 || m.currencyCount > 0) && (
            <p className="mt-3 rounded border border-amber-300 p-3 text-sm">
              This is a subtotal of confirmed USD activity. Review omitted
              transactions and account sources before relying on the remaining
              allowance.
            </p>
          )}
          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <div>
              <p className="text-sm">Posted discretionary</p>
              <p className="mt-1 text-3xl font-semibold">{dollars(m.posted)}</p>
            </div>
            <div>
              <p className="text-sm">Remaining allowance</p>
              <p className="mt-1 text-3xl font-semibold">
                {m.provisional || m.reviewCount > 0 || m.currencyCount > 0
                  ? "Provisional — review required"
                  : dollars(m.remaining)}
              </p>
            </div>
            <div>
              <p className="text-sm">Weekly limit</p>
              <p className="mt-1 text-3xl font-semibold">{dollars(m.limit)}</p>
            </div>
          </div>
          {(m.provisional || m.reviewCount > 0 || m.currencyCount > 0) && (
            <p className="mt-3 text-sm" role="status">
              Confirmed subtotal allowance: {dollars(m.remaining)}. After known
              unreviewed debits and pending purchases:{" "}
              {dollars(
                m.conservativeRemaining ??
                  (m.remaining == null
                    ? null
                    : m.remaining - m.review - m.pending),
              )}
              . This estimate is not a safe-to-spend amount; missing coverage or
              currency data may change it.{" "}
              <a
                href="/transactions?category=needs_review"
                className="underline"
              >
                Review transactions
              </a>
            </p>
          )}
          {m.percentage != null && (
            <>
              <progress
                aria-label="Weekly budget used"
                max="100"
                value={Math.min(100, Math.max(0, m.percentage))}
                className="mt-5 h-3 w-full accent-[var(--accent)]"
              />
              <p className="text-sm">
                {m.percentage.toFixed(0)}% used
                {m.overBudget ? ` · ${dollars(m.overBudget)} over budget` : ""}
              </p>
            </>
          )}
          {m.limit == null && (
            <p className="mt-4 text-sm">
              No weekly limit configured. Monthly planning stays separate.
            </p>
          )}
          <p className="mt-3 text-sm">
            Pending projected spending: <strong>{dollars(m.pending)}</strong> ·
            not deducted from posted allowance.
          </p>
          {m.eligibleCredits > 0 && (
            <p className="mt-2 text-sm">
              Included discretionary credits: {dollars(m.eligibleCredits)}. Net
              weekly spending is capped at zero; category breakdowns retain
              signed credits.
            </p>
          )}
          <p className="mt-2 text-sm">
            Needs review: {m.reviewCount} ({dollars(m.review)}) · Excluded:{" "}
            {dollars(m.excluded)} · Unmatched credits:{" "}
            {dollars(m.unmatchedCredits)} · Non-USD/unknown currency:{" "}
            {m.currencyCount} transactions. Omitted totals include posted and
            pending activity.
          </p>
          <p className="mt-2 text-sm">
            {m.daysRemaining} calendar days remaining, including today ·
            Average/day: {dollars(m.averageDaily)} · Suggested remaining/day:{" "}
            {dollars(m.suggestedDaily)}
          </p>
          <p className="mt-2 text-sm">
            Previous full week: {dollars(m.previous)} · Change from current week
            to date: {m.change >= 0 ? "+" : ""}
            {dollars(m.change)}
          </p>
          <a
            href={`/transactions?start=${m.start}&end=${addDays(m.end, -1)}`}
            className="mt-4 inline-block text-sm underline"
          >
            View this week’s transactions
          </a>
          {editable && (
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {Object.entries(m.breakdown).map(([category, amount]) => (
                <a
                  key={category}
                  className="flex justify-between border-b border-[var(--border)] py-2 text-sm"
                  href={`/transactions?category=${category}&start=${m.start}&end=${addDays(m.end, -1)}`}
                >
                  <span>{categories[category as keyof typeof categories]}</span>
                  <span>{dollars(amount)}</span>
                </a>
              ))}
            </div>
          )}
        </>
      )}
      {editable && data && !loading && !sourcesOnly && (
        <form
          className="mt-5 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate("PUT", {
              weekly_limit: limit.trim() === "" ? null : Number(limit),
            });
          }}
        >
          <label className="text-sm">
            Weekly limit (USD)
            <input
              className="mt-1 block rounded border border-[var(--border)] p-2"
              aria-label="Weekly limit (USD)"
              type="number"
              min="0"
              max="100000000"
              step="0.01"
              value={limit}
              disabled={busy}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="Not set"
            />
          </label>
          <button
            disabled={busy}
            className="rounded border border-[var(--border)] px-4 py-2 text-sm"
          >
            Save weekly limit
          </button>
          <span className="text-xs text-[var(--text-muted)]">
            Leave blank to remove the limit.
          </span>
        </form>
      )}
      {(editable || sourcesOnly) && data && !loading && (
        <div className="mt-6 border-t border-[var(--border)] pt-4">
          <h3 className="font-semibold">Weekly budget account sources</h3>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Confirm one source for each underlying bank account. Exclude
            repeated connections here; all imported records stay intact.
            Unconfirmed sources stay in Needs review. Durable duplicate
            identities use the oldest confirmed source.
          </p>
          {data.accounts.length === 0 && (
            <p className="mt-3 text-sm">
              No imported accounts yet. Refresh saved connections from Overview.
            </p>
          )}
          {data.accounts.map((account, index) => (
            <label
              key={account.id}
              className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"
            >
              <span>
                {account.institution_name} · {account.account_name} · Source{" "}
                {index + 1}
                {` · Imported ${account.created_at.slice(0, 10)}`}
                {accountSources(data.accounts).get(account.id) === "duplicate"
                  ? " · Duplicate identity excluded"
                  : ""}
              </span>
              <select
                aria-label={`Budget source ${account.account_name} ${index + 1}`}
                value={account.weekly_budget_source}
                disabled={busy}
                className="rounded border border-[var(--border)] p-2"
                onChange={(e) =>
                  void mutate("PATCH", {
                    account_id: account.id,
                    source: e.target.value,
                  })
                }
              >
                <option value="review">Needs source review</option>
                <option value="include">Use for weekly budget</option>
                <option value="exclude">Exclude this source</option>
              </select>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
