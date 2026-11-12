"use client";
import { classifyTransaction } from "../../lib/transactionClassification";
import { budgetDecision, type BudgetPolicy } from "../../lib/budgetEngine";
import { useEffect, useRef, useState } from "react";
import {
  categories,
  type BudgetAccount,
  type BudgetCategory,
  type BudgetTransaction,
} from "../../lib/discretionaryBudget";
import {
  FinanceRequestError,
  financeRequest,
  jsonMutation,
} from "../../lib/financeHttp";

type TransactionPage = {
  policy?: BudgetPolicy;
  transactions: BudgetTransaction[];
  accounts: BudgetAccount[];
  page: number;
  hasMore: boolean;
};
const transactionStatus = (t: BudgetTransaction) =>
  t.pending == null ? "Status unknown" : t.pending ? "Pending" : "Posted";
export function transactionAmount(
  t: Pick<BudgetTransaction, "amount" | "transaction_currency" | "account_id">,
  accounts: Pick<BudgetAccount, "id" | "currency">[],
) {
  const value = Number(t.amount),
    currency =
      t.transaction_currency ??
      accounts.find((a) => a.id === t.account_id)?.currency;
  if (
    t.amount == null ||
    (typeof t.amount === "string" && !t.amount.trim()) ||
    !Number.isFinite(value)
  )
    return "Amount unavailable";
  const formatted =
    currency && /^[A-Z]{3}$/.test(currency)
      ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
          Math.abs(value),
        )
      : `${Math.abs(value).toFixed(2)} ${currency ?? "currency unknown"}`;
  return `${value < 0 ? "+" : "−"}${formatted} ${value < 0 ? "credit" : "debit"}`;
}
export default function TransactionsWorkspace({
  initialQuery = "",
  preview = false,
}: {
  initialQuery?: string;
  preview?: boolean;
}) {
  const [query, setQuery] = useState(initialQuery),
    [revision, setRevision] = useState(0);
  const [data, setData] = useState<TransactionPage | null>(null),
    [selected, setSelected] = useState<BudgetTransaction | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void financeRequest<TransactionPage>(`/api/transactions?${query}`, {
      signal: controller.signal,
    })
      .then((result) => {
        if (
          !Array.isArray(result.transactions) ||
          !Array.isArray(result.accounts) ||
          !Number.isInteger(result.page) ||
          typeof result.hasMore !== "boolean"
        )
          throw new Error();
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setData(null);
          setError(
            `Transactions unavailable. ${error instanceof FinanceRequestError ? error.message : "Retry; ask the administrator to verify the transaction migration if this persists."}`,
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, revision]);
  useEffect(() => {
    const update = () => {
      setLoading(true);
      setError(null);
      setRevision((value) => value + 1);
    };
    window.addEventListener("financial-data-refreshed", update);
    window.addEventListener("transaction-preferences-updated", update);
    return () => {
      window.removeEventListener("financial-data-refreshed", update);
      window.removeEventListener("transaction-preferences-updated", update);
    };
  }, []);
  const rows = preview ? data?.transactions.slice(0, 6) : data?.transactions;
  const initial = new URLSearchParams(initialQuery);
  const applyQuery = (value: string) => {
    setLoading(true);
    setError(null);
    setQuery(value);
    setRevision((v) => v + 1);
    setSelected(null);
  };
  const reload = () => {
    setLoading(true);
    setError(null);
    setRevision((v) => v + 1);
  };
  const paginate = (page: number) => {
    const params = new URLSearchParams(query);
    params.set("page", String(page));
    applyQuery(params.toString());
  };
  return (
    <section
      aria-label={preview ? "Recent transactions" : "Transaction browser"}
      className="finance-panel my-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 sm:p-6"
    >
      <div className="flex justify-between gap-3">
        <h2 className="text-xl font-semibold">
          {preview ? "Recent transactions" : "Imported transactions"}
        </h2>
        <a href="/transactions" className="text-sm underline">
          View all transactions
        </a>
      </div>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        Newest first. Credits are money received. Pending spending is projected
        separately from posted allowance. Repeated connections stay visible;
        choose one source per account in{" "}
        <a href="/budget#weekly-spending" className="underline">
          Budget
        </a>
        .
      </p>
      {!preview && (
        <form
          className="my-5 grid gap-3 sm:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            const params = new URLSearchParams();
            for (const [key, value] of new FormData(event.currentTarget))
              if (typeof value === "string" && value.trim())
                params.set(key, value.trim());
            applyQuery(params.toString());
          }}
        >
          <Field label="Search merchant or description">
            <input
              name="q"
              maxLength={100}
              defaultValue={initial.get("q") ?? ""}
            />
          </Field>
          <Field label="Account">
            <select
              name="account"
              key={data?.accounts.length ?? 0}
              defaultValue={initial.get("account") ?? ""}
            >
              <option value="">All accounts</option>
              {data?.accounts.map((a, index) => (
                <option key={a.id} value={a.id}>
                  {a.institution_name} · {a.account_name} · Source {index + 1}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select
              name="category"
              defaultValue={initial.get("category") ?? ""}
            >
              <option value="">All categories</option>
              {Object.entries(categories).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From date">
            <input
              name="start"
              type="date"
              defaultValue={initial.get("start") ?? ""}
            />
          </Field>
          <Field label="Through date">
            <input
              name="end"
              type="date"
              defaultValue={initial.get("end") ?? ""}
            />
          </Field>
          <Field label="Status">
            <select name="status" defaultValue={initial.get("status") ?? ""}>
              <option value="">Pending and posted</option>
              <option value="pending">Pending</option>
              <option value="posted">Posted</option>
            </select>
          </Field>
          <div className="flex gap-3">
            <button
              disabled={loading}
              className="rounded border border-[var(--border)] px-3 py-2 text-sm"
            >
              Apply filters
            </button>
            <a href="/transactions" className="py-2 text-sm underline">
              Clear filters
            </a>
          </div>
        </form>
      )}
      {loading && (
        <p role="status" className="mt-5 animate-pulse">
          Loading transactions...
        </p>
      )}
      {error && (
        <p role="alert" className="mt-5 text-red-700">
          {error}{" "}
          <button onClick={reload} className="underline">
            Retry
          </button>
        </p>
      )}
      {!loading && rows?.length === 0 && (
        <p className="mt-5 rounded border border-dashed border-[var(--border)] p-4">
          No transactions match these filters. Refresh saved connections from
          Overview if no history has been imported. Initial history may still be
          processing.
        </p>
      )}
      {!loading && data && !!rows?.length && (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="mt-5 w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Date",
                    "Merchant / description",
                    "Amount",
                    "Category",
                    "Account",
                    "Status",
                    "Details",
                  ].map((label) => (
                    <th
                      key={label}
                      className="border-b border-[var(--border)] p-3"
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--border)]">
                    <td className="p-3 whitespace-nowrap">{t.date}</td>
                    <td className="p-3">
                      <p>{t.merchant_name ?? t.name}</p>
                      {t.merchant_name && <small>{t.name}</small>}
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {transactionAmount(t, data.accounts)}
                    </td>
                    <td className="p-3">
                      {categories[classifyTransaction(t).category]}
                      {t.category_override && (
                        <small className="block">Manual override</small>
                      )}
                    </td>
                    <td className="p-3">
                      {data.accounts.find((a) => a.id === t.account_id)
                        ?.account_name ?? "Account unavailable"}
                    </td>
                    <td className="p-3">{transactionStatus(t)}</td>
                    <td className="p-3">
                      <button
                        className="underline"
                        onClick={() => setSelected(t)}
                        aria-label={`Details ${t.merchant_name ?? t.name}`}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-5 divide-y divide-[var(--border)] md:hidden">
            {rows.map((t) => (
              <article key={t.id} className="py-4">
                <div className="flex justify-between gap-3">
                  <strong>{t.merchant_name ?? t.name}</strong>
                  <span>{transactionAmount(t, data.accounts)}</span>
                </div>
                <p className="mt-2 text-sm">
                  {t.date} · {transactionStatus(t)} ·{" "}
                  {data.accounts.find((a) => a.id === t.account_id)
                    ?.account_name ?? "Account unavailable"}
                </p>
                <p className="mt-1 text-sm">
                  {categories[classifyTransaction(t).category]}
                  {t.category_override ? " · Manual override" : ""}
                </p>
                <button
                  className="mt-2 text-sm underline"
                  onClick={() => setSelected(t)}
                >
                  Review transaction
                </button>
              </article>
            ))}
          </div>
          {!preview && (
            <div className="mt-5 flex items-center gap-4">
              <button
                disabled={loading || data.page <= 1}
                onClick={() => paginate(data.page - 1)}
                className="rounded border border-[var(--border)] px-3 py-2 disabled:opacity-40"
              >
                Previous
              </button>
              <span>Page {data.page}</span>
              <button
                disabled={loading || !data.hasMore || data.page >= 1000}
                onClick={() => paginate(data.page + 1)}
                className="rounded border border-[var(--border)] px-3 py-2 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      {selected && data && (
        <TransactionDetail
          key={selected.id}
          transaction={selected}
          accounts={data.accounts}
          policy={data.policy}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            reload();
            window.dispatchEvent(new Event("weekly-budget-updated"));
          }}
        />
      )}
    </section>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-sm [&_input]:w-full [&_input]:rounded [&_input]:border [&_input]:border-[var(--border)] [&_input]:p-2 [&_select]:w-full [&_select]:rounded [&_select]:border [&_select]:border-[var(--border)] [&_select]:p-2">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}
function TransactionDetail({
  transaction: t,
  accounts,
  policy,
  onClose,
  onSaved,
}: {
  transaction: BudgetTransaction;
  accounts: BudgetAccount[];
  policy?: BudgetPolicy;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState<BudgetCategory | "">(
      t.category_override ?? "",
    ),
    [inclusion, setInclusion] = useState<"include" | "exclude" | "">(
      t.weekly_budget_override ?? "",
    );
  const [monthly, setMonthly] = useState<"include" | "exclude" | "">(
    t.monthly_budget_override ?? "",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const guard = useRef(false);
  const decision = policy
    ? budgetDecision(
        {
          ...t,
          category_override: category || null,
          weekly_budget_override: inclusion || null,
        },
        accounts,
        policy,
        "weekly",
      )
    : null;
  return (
    <aside
      role="region"
      aria-label="Transaction details"
      className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <div className="flex justify-between">
        <h3 className="text-lg font-semibold">{t.merchant_name ?? t.name}</h3>
        <button disabled={busy} onClick={onClose} className="underline">
          Close details
        </button>
      </div>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt>Date / status</dt>
          <dd>
            {t.date} · {transactionStatus(t)}
          </dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{transactionAmount(t, accounts)}</dd>
        </div>
        <div>
          <dt>Original Plaid category</dt>
          <dd>
            {t.plaid_detailed_category ??
              t.plaid_primary_category ??
              t.category ??
              "Uncategorized"}
          </dd>
        </div>
        <div>
          <dt>Provider confidence</dt>
          <dd>{t.plaid_category_confidence ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Automatic normalized category</dt>
          <dd>
            {
              categories[
                classifyTransaction({ ...t, category_override: null }).category
              ]
            }{" "}
            · {classifyTransaction(t).source}: {classifyTransaction(t).reason}
          </dd>
        </div>
        <div>
          <dt>Weekly decision</dt>
          <dd>
            {decision
              ? `${decision.kind}: ${decision.reason}`
              : "Budget policy unavailable; check Budget before relying on inclusion."}
          </dd>
        </div>
      </dl>
      <form
        className="mt-5 flex flex-wrap items-end gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (guard.current) return;
          guard.current = true;
          setBusy(true);
          setError(null);
          try {
            await financeRequest(
              "/api/transactions",
              jsonMutation("PATCH", {
                id: t.id,
                category_override: category || null,
                weekly_budget_override: inclusion || null,
                ...(monthly !== (t.monthly_budget_override ?? "")
                  ? { monthly_budget_override: monthly || null }
                  : {}),
              }),
            );
            onSaved();
          } catch (error) {
            setError(
              error instanceof Error
                ? error.message
                : "Unable to save correction.",
            );
          } finally {
            guard.current = false;
            setBusy(false);
          }
        }}
      >
        <Field label="Category correction">
          <select
            disabled={busy}
            value={category}
            onChange={(e) => setCategory(e.target.value as BudgetCategory | "")}
          >
            <option value="">Use automatic category</option>
            {Object.entries(categories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Weekly budget inclusion">
          <select
            disabled={busy}
            value={inclusion}
            onChange={(e) => setInclusion(e.target.value as typeof inclusion)}
          >
            <option value="">Use category rules</option>
            <option value="include">Count toward weekly budget</option>
            <option value="exclude">Exclude from weekly budget</option>
          </select>
        </Field>
        <Field label="Monthly budget inclusion">
          <select
            disabled={busy}
            value={monthly}
            onChange={(e) => setMonthly(e.target.value as typeof monthly)}
          >
            <option value="">Use category/account rules</option>
            <option value="include">Count toward monthly spending</option>
            <option value="exclude">Exclude from monthly spending</option>
          </select>
        </Field>
        <button
          disabled={busy}
          className="rounded border border-[var(--border)] px-3 py-2"
        >
          Save correction
        </button>
      </form>
      <p className="mt-3 text-xs text-[var(--text-muted)]">
        Corrections survive provider refresh. Explicit credit classification
        offsets spending only down to zero. Account-source and currency
        exclusions still apply.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </aside>
  );
}
