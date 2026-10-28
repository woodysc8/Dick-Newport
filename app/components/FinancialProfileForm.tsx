"use client";

import { useActionState, useState } from "react";
import type { FinancialProfile } from "../../lib/financialProfileDefaults";
import { saveFinancialProfile, type ProfileActionState } from "../profile/actions";

type Row = { id: string; name: string; amount?: number; category?: string; balance?: number; monthlyPayment?: number; targetAmount?: number; targetDate?: string };
const blankState: ProfileActionState = { errors: {} };

function amount(value: number | undefined) { return value == null ? "" : String(value); }
function rowsFrom<T extends { name: string }>(values: readonly T[] | undefined): (T & { id: string })[] {
  return (values ?? []).map((value, index) => ({ ...value, id: `${index}-${value.name}` }));
}

export default function FinancialProfileForm({ profile, mode, saved = false }: { profile: FinancialProfile; mode: "onboarding" | "settings"; saved?: boolean }) {
  const [state, action, pending] = useActionState(saveFinancialProfile, blankState);
  const [expenses, setExpenses] = useState<Row[]>(rowsFrom(profile.budget?.expenses));
  const [debts, setDebts] = useState<Row[]>(rowsFrom(profile.debts));
  const [goals, setGoals] = useState<Row[]>(rowsFrom(profile.goals));
  const hidden = (name: string, rows: Row[]) => <input type="hidden" name={name} value={JSON.stringify(rows, (key, value: unknown) => key === "id" ? undefined : value)} />;

  return <form action={action} className="space-y-8">
    <input type="hidden" name="returnTo" value={mode} />
    {mode === "onboarding" && <input type="hidden" name="onboarding" value="1" />}
    {saved && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Your profile was saved. You can update these answers at any time.</p>}
    {state.message && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{state.message}</p>}

    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-lg font-semibold">About you</legend>
      <Field label="Full name" error={state.errors.fullName}><input name="fullName" autoComplete="name" defaultValue={profile.personal?.fullName ?? ""} className={inputClass} /></Field>
      <Field label="Country or region" error={state.errors.country}><input name="country" autoComplete="country-name" defaultValue={profile.personal?.country ?? ""} placeholder="Optional" className={inputClass} /></Field>
      <Field label="Household size" error={state.errors.householdSize}><input name="householdSize" type="number" min="1" max="30" step="1" defaultValue={amount(profile.personal?.householdSize)} placeholder="Unknown" className={inputClass} /></Field>
      <Field label="Planning currency"><select name="currency" defaultValue={profile.currency || "USD"} className={inputClass}><option value="USD">USD — US dollar</option><option value="CAD">CAD — Canadian dollar</option><option value="GBP">GBP — British pound</option><option value="EUR">EUR — euro</option><option value="AUD">AUD — Australian dollar</option></select></Field>
      {state.errors.currency && <p role="alert" className="text-sm text-rose-700">{state.errors.currency}</p>}
    </fieldset>

    <fieldset className="grid gap-4 sm:grid-cols-3">
      <legend className="mb-3 text-lg font-semibold">Income</legend>
      <Field label="Income amount" hint="Leave blank when unknown." error={state.errors.incomeAmount}><input name="incomeAmount" type="number" min="0" step="0.01" defaultValue={amount(profile.income?.amount)} placeholder="Not entered" className={inputClass} /></Field>
      <Field label="Income basis" error={state.errors.incomeBasis}><select name="incomeBasis" defaultValue={profile.income?.basis ?? ""} className={inputClass}><option value="">Not entered</option><option value="gross">Gross, before deductions</option><option value="take-home">Take-home, after deductions</option></select></Field>
      <Field label="Pay frequency" error={state.errors.incomeFrequency}><select name="incomeFrequency" defaultValue={profile.income?.frequency ?? ""} className={inputClass}><option value="">Not entered</option><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="semimonthly">Twice monthly</option><option value="monthly">Monthly</option><option value="other">Other / variable</option></select></Field>
    </fieldset>
    <p className="-mt-6 text-xs text-[var(--text-muted)]">Only take-home income is converted to a monthly budget income. Gross income is saved as an assumption and is not treated as spendable cash.</p>

    <fieldset className="space-y-4">
      <legend className="mb-3 text-lg font-semibold">Monthly spending plan</legend>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Overall monthly spending target" error={state.errors.monthlySpendingTarget}><input name="monthlySpendingTarget" type="number" min="0" step="0.01" defaultValue={amount(profile.budget?.monthlySpendingTarget)} placeholder="Not entered" className={inputClass} /></Field><p className="self-end pb-3 text-xs text-[var(--text-muted)]">This is your overall target. Category targets below are recorded separately and are not added to it automatically.</p></div>
      {hidden("monthlyExpenses", expenses)}
      <div className="space-y-3">{expenses.map((row, index) => <div key={row.id} className="grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-[1fr_1fr_150px_auto]">
        <input aria-label={`Category ${index + 1}`} value={row.name} onChange={(e) => setExpenses((items) => items.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} placeholder="Category name" className={inputClass} />
        <input aria-label={`Budget group ${index + 1}`} value={row.category ?? ""} onChange={(e) => setExpenses((items) => items.map((item, i) => i === index ? { ...item, category: e.target.value } : item))} placeholder="Classification" className={inputClass} />
        <input aria-label={`Monthly target ${index + 1}`} type="number" min="0" step="0.01" value={amount(row.amount)} onChange={(e) => setExpenses((items) => items.map((item, i) => i === index ? { ...item, amount: e.target.value === "" ? undefined : Number(e.target.value) } : item))} placeholder="Target amount" className={inputClass} />
        <Remove onClick={() => setExpenses((items) => items.filter((_, i) => i !== index))} />
      </div>)}
      <button type="button" onClick={() => setExpenses((items) => [...items, { id: crypto.randomUUID(), name: "", category: "", amount: undefined }])} className={secondaryButton}>Add category target</button></div>
      {state.errors.monthlyExpenses && <p role="alert" className="text-sm text-rose-700">{state.errors.monthlyExpenses}</p>}
    </fieldset>

    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-lg font-semibold">Cash and savings balances</legend>
      <Field label="Cash balance estimate" hint="Entered by you; this is not connected account data." error={state.errors.cashBalance}><input name="cashBalance" type="number" min="0" step="0.01" defaultValue={amount(profile.manualBalances?.cash)} placeholder="Unknown" className={inputClass} /></Field>
      <Field label="Savings balance estimate" hint="Entered by you; this is not connected account data." error={state.errors.savingsBalance}><input name="savingsBalance" type="number" min="0" step="0.01" defaultValue={amount(profile.manualBalances?.savings)} placeholder="Unknown" className={inputClass} /></Field>
    </fieldset>

    <fieldset className="space-y-4">
      <legend className="mb-3 text-lg font-semibold">Debt balances and payments</legend>{hidden("debts", debts)}
      <p className="text-xs leading-5 text-[var(--text-muted)]">Debt payments are saved separately. Include them in a monthly spending category if you want them counted in that budget; they are not added automatically.</p>
      {debts.map((row, index) => <div key={row.id} className="grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <input aria-label={`Debt ${index + 1} name`} value={row.name} onChange={(e) => setDebts((items) => items.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} placeholder="Debt name" className={inputClass} />
        <input aria-label={`Debt ${index + 1} balance`} type="number" min="0" step="0.01" value={amount(row.balance)} onChange={(e) => setDebts((items) => items.map((item, i) => i === index ? { ...item, balance: e.target.value === "" ? undefined : Number(e.target.value) } : item))} placeholder="Balance unknown" className={inputClass} />
        <input aria-label={`Debt ${index + 1} payment`} type="number" min="0" step="0.01" value={amount(row.monthlyPayment)} onChange={(e) => setDebts((items) => items.map((item, i) => i === index ? { ...item, monthlyPayment: e.target.value === "" ? undefined : Number(e.target.value) } : item))} placeholder="Monthly payment" className={inputClass} />
        <Remove onClick={() => setDebts((items) => items.filter((_, i) => i !== index))} />
      </div>)}
      <button type="button" onClick={() => setDebts((items) => [...items, { id: crypto.randomUUID(), name: "" }])} className={secondaryButton}>Add debt</button>
      {state.errors.debts && <p role="alert" className="text-sm text-rose-700">{state.errors.debts}</p>}
    </fieldset>

    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-lg font-semibold">Retirement and cash safety</legend>
      <Field label="Retirement contribution per paycheck" error={state.errors.retirementPerPaycheck}><input name="retirementPerPaycheck" type="number" min="0" step="0.01" defaultValue={amount(profile.retirementContributions?.perPaycheck)} placeholder="Not entered" className={inputClass} /></Field>
      <Field label="Contribution as % of income" error={state.errors.retirementPercent}><input name="retirementPercent" type="number" min="0" max="100" step="0.01" defaultValue={amount(profile.retirementContributions?.percentageOfIncome)} placeholder="Not entered" className={inputClass} /></Field>
      <Field label="Employer match (%)" error={state.errors.employerMatch}><input name="employerMatch" type="number" min="0" max="100" step="0.01" defaultValue={amount(profile.retirementContributions?.employerMatchPercentage)} placeholder="Not applicable / unknown" className={inputClass} /></Field>
      <Field label="Retirement destination" error={state.errors.retirementDestination}><input name="retirementDestination" defaultValue={profile.retirementContributions?.destination ?? ""} placeholder="Optional" className={inputClass} /></Field>
      <Field label="Emergency-fund target" error={state.errors.emergencyFundTarget}><input name="emergencyFundTarget" type="number" min="0" step="0.01" defaultValue={amount(profile.savingsTargets?.emergencyFund)} placeholder="Not entered" className={inputClass} /></Field>
      <Field label="Minimum cash buffer" error={state.errors.minimumCashBuffer}><input name="minimumCashBuffer" type="number" min="0" step="0.01" defaultValue={amount(profile.savingsTargets?.minimumCashBuffer)} placeholder="Not entered" className={inputClass} /></Field>
    </fieldset>

    <fieldset className="space-y-4">
      <legend className="mb-3 text-lg font-semibold">Financial goals</legend>{hidden("goals", goals)}
      {goals.map((row, index) => <div key={row.id} className="grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-[1fr_1fr_190px_auto]">
        <input aria-label={`Goal ${index + 1} name`} value={row.name} onChange={(e) => setGoals((items) => items.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} placeholder="Goal" className={inputClass} />
        <input aria-label={`Goal ${index + 1} target amount`} type="number" min="0" step="0.01" value={amount(row.targetAmount)} onChange={(e) => setGoals((items) => items.map((item, i) => i === index ? { ...item, targetAmount: e.target.value === "" ? undefined : Number(e.target.value) } : item))} placeholder="Target amount" className={inputClass} />
        <input aria-label={`Goal ${index + 1} target date`} type="date" value={row.targetDate ?? ""} onChange={(e) => setGoals((items) => items.map((item, i) => i === index ? { ...item, targetDate: e.target.value || undefined } : item))} className={inputClass} />
        <Remove onClick={() => setGoals((items) => items.filter((_, i) => i !== index))} />
      </div>)}
      <button type="button" onClick={() => setGoals((items) => [...items, { id: crypto.randomUUID(), name: "" }])} className={secondaryButton}>Add goal</button>
      {state.errors.goals && <p role="alert" className="text-sm text-rose-700">{state.errors.goals}</p>}
    </fieldset>

    <p className="text-sm leading-6 text-[var(--text-muted)]">Blank values stay unknown. Cash and savings figures above are manual estimates; connected balances remain separate. The app does not convert currencies, so connected balances and transactions should use a single currency before interpreting combined totals.</p>
    <button disabled={pending} className="rounded-lg bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : mode === "onboarding" ? "Save profile and continue" : "Save changes"}</button>
  </form>;
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5 text-sm font-medium">{label}{children}{hint && <span className="block text-xs font-normal text-[var(--text-muted)]">{hint}</span>}{error && <span role="alert" className="block text-xs font-normal text-rose-700">{error}</span>}</label>;
}

function Remove({ onClick }: { onClick: () => void }) { return <button type="button" onClick={onClick} className={secondaryButton}>Remove</button>; }

const inputClass = "mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]";
const secondaryButton = "rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface)]";
