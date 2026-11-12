"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { weekPeriod } from "../../lib/discretionaryBudget";
import { categories, type BudgetCategory } from "../../lib/discretionaryBudget";
import type { financialBudget, BudgetPolicy } from "../../lib/budgetEngine";
import { financeRequest, jsonMutation } from "../../lib/financeHttp";
import type { BudgetAccount } from "../../lib/discretionaryBudget";

type Data = ReturnType<typeof financialBudget> & {
  policy: BudgetPolicy;
  accounts: BudgetAccount[];
};
function checkedData(data: Data) {
  if (
    !data.weekly ||
    !data.monthly?.groups ||
    !data.monthly.cashflow ||
    !data.policy ||
    !Array.isArray(data.policy.categories) ||
    !Array.isArray(data.policy.accounts) ||
    !Array.isArray(data.accounts) ||
    !Array.isArray(data.caps)
  )
    throw new Error("Invalid budget response");
  return data;
}
const usd = (n: number | null) =>
  n == null
    ? "Unset"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(n);
export default function BudgetEngine({
  editable = false,
}: {
  editable?: boolean;
}) {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const sequence = useRef({ value: 0 });
  const load = useCallback(() => {
    const current = ++sequence.current.value;
    return financeRequest<Data>("/api/budget-engine")
      .then(checkedData)
      .then((data) => {
        if (current === sequence.current.value) {
          setData(data);
          setError("");
        }
      })
      .catch(() => {
        if (current === sequence.current.value) {
          setData(null);
          setError(
            "Budget rules are unavailable. The administrator must approve and deploy the budget engine migration before activation.",
          );
        }
      });
  }, []);
  useEffect(() => {
    const pending = sequence.current;
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("weekly-budget-updated", refresh);
    window.addEventListener("financial-data-refreshed", refresh);
    return () => {
      pending.value++;
      window.removeEventListener("weekly-budget-updated", refresh);
      window.removeEventListener("financial-data-refreshed", refresh);
    };
  }, [load]);
  useEffect(() => {
    let day = weekPeriod().today;
    const check = () => {
      const next = weekPeriod().today;
      if (next !== day) {
        day = next;
        void load();
      }
    };
    const timer = window.setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [load]);
  const save = async (body: unknown) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await financeRequest("/api/budget-engine", jsonMutation("PUT", body));
      setNotice("Budget rule saved; original transactions unchanged.");
      await load();
      window.dispatchEvent(new Event("weekly-budget-updated"));
    } catch {
      setError(
        "Unable to save this budget rule. Check the amount, account ownership and migration readiness.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="finance-panel my-6 rounded-2xl border border-[var(--border)] p-5"
      aria-label="Monthly spending and budget rules"
    >
      <h2 className="text-xl font-semibold">
        Monthly spending &amp; budget rules
      </h2>
      {error && (
        <p role="alert" className="mt-3">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <p role="status">Loading budget rules…</p>}
      {data && (
        <>
          <p className="mt-3 text-sm">
            {data.monthly.start} through {data.monthly.end} (exclusive),
            America/New_York. Observed spending; monthly planning remains
            separate.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <p>
              Confirmed classified posted subtotal: <strong>{usd(data.monthly.posted)}</strong>
            </p>
            <p>
              Pending: <strong>{usd(data.monthly.pending)}</strong>
            </p>
            <p>
              Monthly limit: <strong>{usd(data.monthly.limit)}</strong>
            </p>
            <p>
              Fixed obligations (including rent):{" "}
              {usd(data.monthly.groups.fixed ?? 0)}
            </p>
            <p>Essential-variable: {usd(data.monthly.groups.essential ?? 0)}</p>
            <p>Discretionary: {usd(data.monthly.groups.discretionary ?? 0)}</p>
          </div>
          <p className="mt-3 text-sm">
            Needs review: {data.monthly.reviewCount} ({usd(data.monthly.review)}
            ).{" "}
            {data.monthly.provisional
              ? "Totals are provisional; no safe remaining amount is implied."
              : `Confirmed remaining: ${usd(data.monthly.remaining)}.`}{" "}
            Cash inflow {usd(data.monthly.cashflow.inflow)}, outflow{" "}
            {usd(data.monthly.cashflow.outflow)}; movements are cash flow, not
            spending.
          </p>
          <p className="mt-2 text-sm">
            Previous complete month: {usd(data.monthly.previousCompleteMonth)}.
            Current month is partial; these are different-length comparison
            periods.
          </p>
          {editable && (
            <>
              <form
                className="mt-4 flex flex-wrap gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void save({
                    kind: "monthly",
                    monthly_limit:
                      f.get("limit") === "" ? null : Number(f.get("limit")),
                  });
                }}
              >
                <label>
                  Monthly spending limit (USD)
                  <input
                    key={data.monthly.limit ?? "unset"}
                    name="limit"
                    type="number"
                    min="0"
                    max="100000000"
                    step="0.01"
                    defaultValue={data.monthly.limit ?? ""}
                    className="ml-2 w-36 rounded border p-2"
                  />
                </label>
                <button disabled={busy} className="rounded border px-3">
                  Save monthly limit
                </button>
              </form>
              <p className="mt-4 text-sm">
                Safety gates (currency, confirmed source and duplicate identity)
                take priority. Then: transaction override → account inclusion →
                category inclusion → default. Groceries are weekly included;
                rent is weekly excluded and monthly fixed by default. Blank caps
                are unset; zero is an explicit cap.
              </p>
              <details className="mt-4">
                <summary className="cursor-pointer font-semibold">
                  Category inclusion and optional caps
                </summary>
                <div className="mt-3 space-y-3">
                  {Object.entries(categories).map(([key, label]) => {
                    const category = key as BudgetCategory,
                      rule = data.policy.categories.find(
                        (r) => r.category === category,
                      );
                    return (
                      <form
                        key={category}
                        className="flex flex-wrap items-end gap-3 rounded border border-[var(--border)] p-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget),
                            val = (key: string) =>
                              f.get(key) === "default"
                                ? null
                                : f.get(key) === "include",
                            cap = (key: string) =>
                              f.get(key) === "" ? null : Number(f.get(key));
                          void save({
                            kind: "category",
                            category,
                            weekly_included: val("weekly"),
                            monthly_included: val("monthly"),
                            monthly_group:
                              f.get("group") === "default"
                                ? null
                                : f.get("group"),
                            weekly_cap: cap("weekly_cap"),
                            monthly_cap: cap("monthly_cap"),
                          });
                        }}
                      >
                        <strong className="w-full">{label}</strong>
                        {(["weekly", "monthly"] as const).map((period) => (
                          <label key={period}>
                            {period}
                            <select
                              name={period}
                              defaultValue={
                                rule?.[`${period}_included`] == null
                                  ? "default"
                                  : rule[`${period}_included`]
                                    ? "include"
                                    : "exclude"
                              }
                              className="ml-2 rounded border p-2"
                            >
                              <option value="default">Use default</option>
                              <option value="include">Include</option>
                              <option value="exclude">Exclude</option>
                            </select>
                          </label>
                        ))}
                        <label>
                          Monthly group
                          <select
                            name="group"
                            defaultValue={rule?.monthly_group ?? "default"}
                            className="ml-2 rounded border p-2"
                          >
                            {[
                              "default",
                              "fixed",
                              "essential",
                              "discretionary",
                              "excluded",
                            ].map((g) => (
                              <option key={g}>{g}</option>
                            ))}
                          </select>
                        </label>
                        {(["weekly_cap", "monthly_cap"] as const).map((cap) => (
                          <label key={cap}>
                            {cap.replace("_", " ")}
                            <input
                              name={cap}
                              type="number"
                              min="0"
                              max="100000000"
                              step="0.01"
                              defaultValue={rule?.[cap] ?? ""}
                              className="ml-2 w-24 rounded border p-2"
                            />
                          </label>
                        ))}
                        <button disabled={busy} className="rounded border p-2">
                          Save {label}
                        </button>
                      </form>
                    );
                  })}
                </div>
              </details>
              <details className="mt-4">
                <summary className="cursor-pointer font-semibold">
                  Independent account inclusion rules
                </summary>
                {data.accounts.map((account) => {
                  const rule = data.policy.accounts.find(
                    (r) => r.account_id === account.id,
                  );
                  return (
                    <form
                      key={account.id}
                      className="mt-3 flex flex-wrap gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget),
                          val = (key: string) =>
                            f.get(key) === "default"
                              ? null
                              : f.get(key) === "include";
                        void save({
                          kind: "account",
                          account_id: account.id,
                          weekly_included: val("weekly"),
                          monthly_included: val("monthly"),
                        });
                      }}
                    >
                      <span>{account.account_name}</span>
                      {(["weekly", "monthly"] as const).map((p) => (
                        <label key={p}>
                          {p}
                          <select
                            name={p}
                            defaultValue={
                              rule?.[`${p}_included`] == null
                                ? "default"
                                : rule[`${p}_included`]
                                  ? "include"
                                  : "exclude"
                            }
                          >
                            <option value="default">Category default</option>
                            <option value="include">Include purchases</option>
                            <option value="exclude">Exclude purchases</option>
                          </select>
                        </label>
                      ))}
                      <button disabled={busy}>Save account rule</button>
                    </form>
                  );
                })}
              </details>
            </>
          )}
          <div className="mt-4 text-sm">
            {data.caps
              .filter((c) => c.weekly_limit != null || c.monthly_limit != null)
              .map((c) => (
                <p key={c.category}>
                  {categories[c.category]}: week {usd(c.weekly_spent)} /{" "}
                  {usd(c.weekly_limit)}; month {usd(c.monthly_spent)} /{" "}
                  {usd(c.monthly_limit)}
                </p>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
