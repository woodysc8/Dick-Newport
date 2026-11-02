"use client";

import { useActionState, useState } from "react";
import type {
  DebtProfile,
  FinancialAccountProfile,
  FinancialGoalProfile,
  FinancialProfile,
  IncomeFrequency,
  IncomeSource,
  RecurringExpenseProfile,
  RetirementContributionProfile,
  SavingsAllocationProfile,
} from "../../lib/financialProfileDefaults";
import { appendRecord, removeRecord, updateRecord, type EditableRecord } from "../../lib/profileCollectionEditor";
import { saveFinancialProfile, type ProfileActionState } from "../profile/actions";

type BudgetRow = { name: string; category: string; amount: number };
type Setter<T> = React.Dispatch<React.SetStateAction<EditableRecord<T>[]>>;
const blankState: ProfileActionState = { errors: {} };

function amount(value: number | undefined): string { return value == null ? "" : String(value); }
function rowsFrom<T>(values: readonly T[] | undefined, label: (value: T, index: number) => string): EditableRecord<T>[] {
  return (values ?? []).map((value, index) => ({ ...value, id: `profile-row-${index}-${label(value, index)}` }));
}
function stripEditorId<T>(row: EditableRecord<T>): T {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "id")) as T;
}
function add<T>(setRows: Setter<T>, value: T) {
  setRows((rows) => appendRecord(rows, { ...value, id: crypto.randomUUID() }));
}
function patch<T>(setRows: Setter<T>, id: string, value: Partial<T>) {
  setRows((rows) => updateRecord(rows, id, value));
}
function remove<T>(setRows: Setter<T>, id: string) {
  setRows((rows) => removeRecord(rows, id));
}
function hiddenRows<T>(name: string, rows: readonly EditableRecord<T>[]) {
  return <input type="hidden" name={name} value={JSON.stringify(rows.map(stripEditorId))} />;
}
function isBudgetEligible(source: Partial<IncomeSource>): boolean {
  return source.basis === "net" && source.amount !== undefined && source.regularity === "regular" && !!source.frequency && source.frequency !== "irregular" && source.frequency !== "other";
}
function selectedValue(value: string | undefined): string { return value ?? ""; }

export default function FinancialProfileForm({ profile, mode, saved = false }: { profile: FinancialProfile; mode: "onboarding" | "settings"; saved?: boolean }) {
  const [state, action, pending] = useActionState(saveFinancialProfile, blankState);
  const [incomeSources, setIncomeSources] = useState(rowsFrom(profile.incomeSources, (row, index) => row.name || String(index)));
  const [financialAccounts, setFinancialAccounts] = useState(rowsFrom(profile.financialAccounts, (row, index) => row.name || String(index)));
  const [retirementPlans, setRetirementPlans] = useState(rowsFrom(profile.retirementContributionPlans, (row, index) => row.name || row.destinationAccountName || String(index)));
  const [debts, setDebts] = useState(rowsFrom(profile.debts, (row, index) => row.name || String(index)));
  const [recurringExpenses, setRecurringExpenses] = useState(rowsFrom(profile.recurringExpenses, (row, index) => row.name || String(index)));
  const [savingsAllocations, setSavingsAllocations] = useState(rowsFrom(profile.savingsAllocations, (row, index) => row.name || String(index)));
  const [goals, setGoals] = useState(rowsFrom(profile.goals, (row, index) => row.name || String(index)));
  const [budgetRows, setBudgetRows] = useState(rowsFrom(profile.budget?.expenses, (row, index) => row.name || String(index)));
  const hiddenBudgetRows = <input type="hidden" name="monthlyExpenses" value={JSON.stringify(budgetRows.map(stripEditorId))} />;

  return <form action={action} className="space-y-8">
    <input type="hidden" name="returnTo" value={mode} />
    {mode === "onboarding" && <input type="hidden" name="onboarding" value="1" />}
    {saved && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">Your profile was saved. You can update these answers at any time.</p>}
    {state.message && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900"><p>{state.message}</p>{state.conflict && <button type="button" onClick={() => window.location.reload()} className="mt-2 font-semibold underline">Reload latest profile</button>}</div>}

    <fieldset className="grid gap-4 sm:grid-cols-2">
      <legend className="mb-3 text-lg font-semibold">About you</legend>
      <Field label="Full name"><input name="fullName" autoComplete="name" defaultValue={profile.personal?.fullName ?? ""} className={inputClass} /></Field>
      <Field label="Country or region"><input name="country" autoComplete="country-name" defaultValue={profile.personal?.country ?? ""} placeholder="Optional" className={inputClass} /></Field>
      <Field label="Household size" error={state.errors.householdSize}><input name="householdSize" type="number" min="1" max="30" step="1" defaultValue={amount(profile.personal?.householdSize)} placeholder="Unknown" className={inputClass} /></Field>
      <Field label="Planning currency" error={state.errors.currency}><select name="currency" defaultValue={profile.currency || "USD"} className={inputClass}><option value="USD">USD — US dollar</option><option value="CAD">CAD — Canadian dollar</option><option value="GBP">GBP — British pound</option><option value="EUR">EUR — euro</option><option value="AUD">AUD — Australian dollar</option></select></Field>
    </fieldset>

    <section className="space-y-4" aria-labelledby="income-heading">
      <SectionHeading id="income-heading" title="Income sources" description="Add regular or irregular sources separately. Unknown amounts stay blank. Gross income is not treated as take-home pay." />
      {hiddenRows("incomeSources", incomeSources)}
      {incomeSources.map((row, index) => {
        const eligible = isBudgetEligible(row);
        const rowError = (field: string) => state.errors[`incomeSources.${index}.${field}`];
        return <article key={row.id} className={cardClass} aria-label={`Income source ${index + 1}`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={`Source ${index + 1} name`} error={rowError("name")}><input value={row.name} onChange={(event) => patch(incomeSourcesSetter(setIncomeSources), row.id, { name: event.target.value })} placeholder="Example: Main job" className={inputClass} /></Field>
            <Field label="Income type"><select value={row.type} onChange={(event) => patch(incomeSourcesSetter(setIncomeSources), row.id, { type: event.target.value as IncomeSource["type"] })} className={inputClass}><option value="employment">Employment</option><option value="self-employment">Self-employment</option><option value="benefit">Benefit</option><option value="rental">Rental</option><option value="investment">Investment income</option><option value="other">Other</option></select></Field>
            <Field label="Amount" hint="Leave blank if unknown." error={rowError("amount")}><input type="number" min="0" step="0.01" value={amount(row.amount)} onChange={(event) => patch(incomeSourcesSetter(setIncomeSources), row.id, { amount: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="Unknown" className={inputClass} /></Field>
            <Field label="Income basis" error={rowError("basis")}><select value={selectedValue(row.basis)} onChange={(event) => {
              const basis = event.target.value as IncomeSource["basis"];
              patch(incomeSourcesSetter(setIncomeSources), row.id, { basis, ...(basis !== "net" ? { includeInBudgetEstimate: false } : {}) });
            }} className={inputClass}><option value="">Not entered</option><option value="gross">Gross, before deductions</option><option value="net">Take-home, after deductions</option></select></Field>
            <Field label="Frequency" error={rowError("frequency")}><select value={selectedValue(row.frequency)} onChange={(event) => {
              const frequency = event.target.value as IncomeFrequency | undefined;
              patch(incomeSourcesSetter(setIncomeSources), row.id, { frequency, ...((frequency === "irregular" || frequency === "other") ? { includeInBudgetEstimate: false } : {}) });
            }} className={inputClass}><FrequencyOptions includeOther /></select></Field>
            <Field label="Regularity" error={rowError("regularity")}><select value={selectedValue(row.regularity)} onChange={(event) => {
              const regularity = event.target.value as IncomeSource["regularity"];
              patch(incomeSourcesSetter(setIncomeSources), row.id, { regularity, ...(regularity !== "regular" ? { includeInBudgetEstimate: false } : {}) });
            }} className={inputClass}><option value="">Not entered</option><option value="regular">Regular</option><option value="irregular">Irregular</option></select></Field>
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={eligible && row.includeInBudgetEstimate === true} disabled={!eligible} onChange={(event) => patch(incomeSourcesSetter(setIncomeSources), row.id, { includeInBudgetEstimate: event.target.checked })} /><span>Include in a future budget estimate <span className="block text-xs text-[var(--text-muted)]">Only known, regular take-home sources can be selected. Gross pay is not added to net pay.</span></span></label>
          <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Optional dates</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Start date" error={rowError("startDate")}><input type="date" value={row.startDate ?? ""} onChange={(event) => patch(incomeSourcesSetter(setIncomeSources), row.id, { startDate: event.target.value || undefined })} className={inputClass} /></Field><Field label="End date" error={rowError("endDate")}><input type="date" value={row.endDate ?? ""} onChange={(event) => patch(incomeSourcesSetter(setIncomeSources), row.id, { endDate: event.target.value || undefined })} className={inputClass} /></Field></div></details>
          <Remove onClick={() => remove(incomeSourcesSetter(setIncomeSources), row.id)} label={`Remove income source ${index + 1}`} />
          {Object.entries(state.errors).filter(([key]) => key.startsWith(`incomeSources.${index}.`)).map(([key, message]) => <p key={key} role="alert" className="mt-2 text-xs text-rose-700">{message}</p>)}
        </article>;
      })}
      <ErrorMessage message={state.errors.incomeSources} />
      <AddButton onClick={() => add(incomeSourcesSetter(setIncomeSources), { name: "", type: "employment", includeInBudgetEstimate: false })}>Add income source</AddButton>
    </section>

    <section className="space-y-4" aria-labelledby="accounts-heading">
      <SectionHeading id="accounts-heading" title="Financial accounts and balances" description="Enter labels only; never enter account numbers or credentials. Manual estimates remain distinct from imported balances." />
      {hiddenRows("financialAccounts", financialAccounts)}
      {financialAccounts.map((row, index) => <article key={row.id} className={cardClass} aria-label={`Financial account ${index + 1}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={`Account ${index + 1} name`} error={state.errors[`financialAccounts.${index}.name`]}><input value={row.name} onChange={(event) => patch(financialAccountsSetter(setFinancialAccounts), row.id, { name: event.target.value })} placeholder="Example: Emergency savings" className={inputClass} /></Field>
          <Field label="Account type"><select value={row.accountType} onChange={(event) => patch(financialAccountsSetter(setFinancialAccounts), row.id, { accountType: event.target.value as FinancialAccountProfile["accountType"] })} className={inputClass}><option value="unknown">Not entered</option><option value="cash">Cash</option><option value="depository">Bank account</option><option value="credit">Credit card</option><option value="investment">Brokerage</option><option value="retirement">Retirement</option><option value="loan">Loan</option><option value="other">Other</option></select></Field>
          <Field label="Subtype"><input value={row.subtype ?? ""} onChange={(event) => patch(financialAccountsSetter(setFinancialAccounts), row.id, { subtype: event.target.value || undefined })} placeholder="Checking, Roth IRA, taxable…" className={inputClass} /></Field>
          <Field label="Institution label"><input value={row.institutionLabel ?? ""} onChange={(event) => patch(financialAccountsSetter(setFinancialAccounts), row.id, { institutionLabel: event.target.value || undefined })} placeholder="Optional" className={inputClass} /></Field>
          <Field label="Currency"><input value={row.currency ?? ""} onChange={(event) => patch(financialAccountsSetter(setFinancialAccounts), row.id, { currency: event.target.value.toUpperCase() || undefined })} maxLength={3} placeholder={profile.currency} className={inputClass} /></Field>
          <Field label="Balance" hint="Leave blank when unknown. Negative balances are allowed for overdrafts." error={state.errors[`financialAccounts.${index}.balance`]}><input type="number" step="0.01" value={amount(row.balance)} onChange={(event) => patch(financialAccountsSetter(setFinancialAccounts), row.id, { balance: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="Unknown" className={inputClass} /></Field>
          <Field label="Balance source" error={state.errors[`financialAccounts.${index}.balanceSource`]}><select value={row.balanceSource} onChange={(event) => patch(financialAccountsSetter(setFinancialAccounts), row.id, { balanceSource: event.target.value as FinancialAccountProfile["balanceSource"], ...(event.target.value === "unknown" ? { balance: undefined } : {}) })} className={inputClass}><option value="unknown">Unknown / not entered</option><option value="manual">Entered by me</option><option value="imported">Imported from an institution</option></select></Field>
        </div>
        <Remove onClick={() => remove(financialAccountsSetter(setFinancialAccounts), row.id)} label={`Remove account ${index + 1}`} />
      </article>)}
      <ErrorMessage message={state.errors.financialAccounts} />
      <AddButton onClick={() => add(financialAccountsSetter(setFinancialAccounts), { name: "", accountType: "unknown", balanceSource: "unknown" })}>Add financial account</AddButton>
    </section>

    <fieldset className="space-y-4">
      <legend className="mb-3 text-lg font-semibold">Monthly budget targets</legend>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Overall monthly spending target" error={state.errors.monthlySpendingTarget}><input name="monthlySpendingTarget" type="number" min="0" step="0.01" defaultValue={amount(profile.budget?.monthlySpendingTarget)} placeholder="Not entered" className={inputClass} /></Field><p className="self-end pb-3 text-xs text-[var(--text-muted)]">This is your overall target. Category targets below are not automatically added to recurring expenses.</p></div>
      {hiddenBudgetRows}
      {budgetRows.map((row, index) => <div key={row.id} className="grid gap-2 rounded-lg border border-[var(--border)] p-3 sm:grid-cols-[1fr_1fr_150px_auto]"><input aria-label={`Budget category ${index + 1}`} value={row.name} onChange={(event) => patch(budgetSetter(setBudgetRows), row.id, { name: event.target.value })} placeholder="Category name" className={inputClass} /><input aria-label={`Budget category group ${index + 1}`} value={row.category} onChange={(event) => patch(budgetSetter(setBudgetRows), row.id, { category: event.target.value })} placeholder="Classification" className={inputClass} /><input aria-label={`Budget target ${index + 1}`} type="number" min="0" step="0.01" value={amount(row.amount)} onChange={(event) => patch(budgetSetter(setBudgetRows), row.id, { amount: event.target.value === "" ? undefined as never : Number(event.target.value) })} placeholder="Unknown" className={inputClass} /><Remove onClick={() => remove(budgetSetter(setBudgetRows), row.id)} label={`Remove budget target ${index + 1}`} /></div>)}
      <AddButton onClick={() => add(budgetSetter(setBudgetRows), { name: "", category: "", amount: 0 })}>Add category target</AddButton>
      <ErrorMessage message={state.errors.monthlyExpenses} />
    </fieldset>

    <section className="space-y-4" aria-labelledby="retirement-heading">
      <SectionHeading id="retirement-heading" title="Retirement contributions" description="Employee contributions and employer matches are separate. A match is not money deducted from your pay." />
      {hiddenRows("retirementContributionPlans", retirementPlans)}
      {retirementPlans.map((row, index) => <article key={row.id} className={cardClass} aria-label={`Retirement contribution plan ${index + 1}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Plan label"><input value={row.name ?? ""} onChange={(event) => patch(retirementSetter(setRetirementPlans), row.id, { name: event.target.value || undefined })} placeholder="Work plan, IRA…" className={inputClass} /></Field>
          <Field label="Destination account"><input value={row.destinationAccountName ?? ""} onChange={(event) => patch(retirementSetter(setRetirementPlans), row.id, { destinationAccountName: event.target.value || undefined })} placeholder="Optional" className={inputClass} /></Field>
          <Field label="Employee contribution format"><select value={row.contribution.basis} onChange={(event) => {
            const basis = event.target.value as RetirementContributionProfile["contribution"]["basis"];
            const contribution = basis === "amount" ? { basis, amount: row.contribution.amount, frequency: row.contribution.frequency }
              : basis === "percentage" ? { basis, percentage: row.contribution.percentage, percentageOf: row.contribution.basis === "percentage" ? row.contribution.percentageOf : "unknown" as const, frequency: row.contribution.frequency }
                : { basis, amount: row.contribution.amount, percentage: row.contribution.percentage, frequency: row.contribution.frequency };
            patch(retirementSetter(setRetirementPlans), row.id, { contribution });
          }} className={inputClass}><option value="amount">Fixed amount</option><option value="percentage">Percentage</option><option value="legacy-unresolved">Legacy values not yet reconciled</option></select></Field>
          {(row.contribution.basis === "amount" || row.contribution.basis === "legacy-unresolved") && <Field label="Employee contribution amount" hint="Leave blank if unknown." error={state.errors[`retirementContributionPlans.${index}.amount`]}><input type="number" min="0" step="0.01" value={amount(row.contribution.amount)} onChange={(event) => patchContribution(retirementSetter(setRetirementPlans), row.id, { amount: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="Unknown" className={inputClass} /></Field>}
          {(row.contribution.basis === "percentage" || row.contribution.basis === "legacy-unresolved") && <Field label="Employee contribution percentage" error={state.errors[`retirementContributionPlans.${index}.percentage`]}><input type="number" min="0" max="100" step="0.01" value={amount(row.contribution.percentage)} onChange={(event) => patchContribution(retirementSetter(setRetirementPlans), row.id, { percentage: event.target.value === "" ? undefined : Number(event.target.value), ...(row.contribution.basis === "percentage" ? { percentageOf: row.contribution.percentageOf } : {}) })} placeholder="Unknown" className={inputClass} /></Field>}
          {row.contribution.basis === "percentage" && <Field label="Percentage applies to"><select value={row.contribution.percentageOf} onChange={(event) => patchContribution(retirementSetter(setRetirementPlans), row.id, { percentageOf: event.target.value as "gross-income" | "net-income" | "unknown" })} className={inputClass}><option value="unknown">Income basis unknown</option><option value="gross-income">Gross income</option><option value="net-income">Take-home income</option></select></Field>}
          <Field label="Contribution frequency"><select value={selectedValue(row.contribution.frequency)} onChange={(event) => patchContribution(retirementSetter(setRetirementPlans), row.id, { frequency: event.target.value as IncomeFrequency | undefined })} className={inputClass}><FrequencyOptions includeOther /></select></Field>
        </div>
        <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">Employer match details</summary><p className="my-2 text-xs text-[var(--text-muted)]">Employer match is recorded separately from employee contributions and is not treated as take-home income.</p><div className="grid gap-3 sm:grid-cols-3"><Field label="Employer match percentage" error={state.errors[`retirementContributionPlans.${index}.employerMatch`]}><input type="number" min="0" max="100" step="0.01" value={amount(row.employerMatch?.percentage)} onChange={(event) => patch(retirementSetter(setRetirementPlans), row.id, { employerMatch: { ...row.employerMatch, percentage: event.target.value === "" ? undefined : Number(event.target.value) } })} placeholder="Unknown" className={inputClass} /></Field><Field label="Match is based on"><select value={row.employerMatch?.basis ?? "unknown"} onChange={(event) => patch(retirementSetter(setRetirementPlans), row.id, { employerMatch: { ...row.employerMatch, basis: event.target.value as "salary" | "employee-contribution" | "unknown" } })} className={inputClass}><option value="unknown">Not entered</option><option value="employee-contribution">Employee contribution</option><option value="salary">Salary</option></select></Field><Field label="Maximum percentage of salary"><input type="number" min="0" max="100" step="0.01" value={amount(row.employerMatch?.maximumPercentageOfSalary)} onChange={(event) => patch(retirementSetter(setRetirementPlans), row.id, { employerMatch: { ...row.employerMatch, maximumPercentageOfSalary: event.target.value === "" ? undefined : Number(event.target.value) } })} placeholder="Unknown" className={inputClass} /></Field></div></details>
        <Remove onClick={() => remove(retirementSetter(setRetirementPlans), row.id)} label={`Remove retirement plan ${index + 1}`} />
      </article>)}
      <ErrorMessage message={state.errors.retirementContributionPlans} />
      <AddButton onClick={() => add(retirementSetter(setRetirementPlans), { name: "", contribution: { basis: "amount", frequency: undefined } })}>Add retirement plan</AddButton>
    </section>

    <section className="space-y-4" aria-labelledby="debts-heading">
      <SectionHeading id="debts-heading" title="Debts" description="Balance, interest, and payment details are optional. Monthly payment and minimum payment are kept distinct." />
      {hiddenRows("debts", debts)}
      {debts.map((row, index) => <article key={row.id} className={cardClass} aria-label={`Debt ${index + 1}`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label={`Debt ${index + 1} name`} error={state.errors[`debts.${index}.name`]}><input value={row.name} onChange={(event) => patch(debtSetter(setDebts), row.id, { name: event.target.value })} placeholder="Example: Auto loan" className={inputClass} /></Field><Field label="Debt type"><select value={selectedValue(row.type)} onChange={(event) => patch(debtSetter(setDebts), row.id, { type: (event.target.value || undefined) as DebtProfile["type"] })} className={inputClass}><option value="">Not entered</option><option value="credit-card">Credit card</option><option value="student-loan">Student loan</option><option value="mortgage">Mortgage</option><option value="auto-loan">Auto loan</option><option value="personal-loan">Personal loan</option><option value="other">Other</option></select></Field><Field label="Balance" error={state.errors[`debts.${index}.balance`]}><input type="number" min="0" step="0.01" value={amount(row.balance)} onChange={(event) => patch(debtSetter(setDebts), row.id, { balance: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="Unknown" className={inputClass} /></Field><Field label="Annual interest rate (%)" error={state.errors[`debts.${index}.annualInterestRatePercent`]}><input type="number" min="0" step="0.01" value={amount(row.annualInterestRatePercent)} onChange={(event) => patch(debtSetter(setDebts), row.id, { annualInterestRatePercent: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="Unknown" className={inputClass} /></Field><Field label="Minimum payment" error={state.errors[`debts.${index}.payment`]}><input type="number" min="0" step="0.01" value={amount(row.minimumPayment)} onChange={(event) => patch(debtSetter(setDebts), row.id, { minimumPayment: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="Unknown" className={inputClass} /></Field><Field label="Payment frequency"><select value={row.paymentFrequency ?? ""} onChange={(event) => patch(debtSetter(setDebts), row.id, { paymentFrequency: event.target.value as DebtProfile["paymentFrequency"] })} className={inputClass}><FrequencyOptions /></select></Field></div>
        {row.monthlyPayment !== undefined && <details className="mt-3"><summary className="cursor-pointer text-sm">Legacy monthly payment setting</summary><Field label="Saved monthly payment (minimum-payment meaning unknown)" hint="Kept for backward compatibility; this does not replace the minimum payment above."><input type="number" min="0" step="0.01" value={amount(row.monthlyPayment)} onChange={(event) => patch(debtSetter(setDebts), row.id, { monthlyPayment: event.target.value === "" ? undefined : Number(event.target.value) })} className={inputClass} /></Field></details>}
        <Remove onClick={() => remove(debtSetter(setDebts), row.id)} label={`Remove debt ${index + 1}`} />
      </article>)}
      <ErrorMessage message={state.errors.debts} />
      <AddButton onClick={() => add(debtSetter(setDebts), { name: "" })}>Add debt</AddButton>
    </section>

    <section className="space-y-4" aria-labelledby="expenses-heading">
      <SectionHeading id="expenses-heading" title="Recurring expenses" description="These are recurring obligations, separate from monthly budget category targets." />
      {hiddenRows("recurringExpenses", recurringExpenses)}
      {recurringExpenses.map((row, index) => <article key={row.id} className={cardClass} aria-label={`Recurring expense ${index + 1}`}><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Field label={`Expense ${index + 1} name`}><input value={row.name} onChange={(event) => patch(expenseSetter(setRecurringExpenses), row.id, { name: event.target.value })} placeholder="Example: Rent" className={inputClass} /></Field><Field label="Category"><input value={row.category ?? ""} onChange={(event) => patch(expenseSetter(setRecurringExpenses), row.id, { category: event.target.value || undefined })} placeholder="Optional" className={inputClass} /></Field><Field label="Amount" error={state.errors[`recurringExpenses.${index}.amount`]}><input type="number" min="0" step="0.01" value={amount(row.amount)} onChange={(event) => patch(expenseSetter(setRecurringExpenses), row.id, { amount: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="Unknown" className={inputClass} /></Field><Field label="Frequency"><select value={row.frequency ?? ""} onChange={(event) => patch(expenseSetter(setRecurringExpenses), row.id, { frequency: (event.target.value || undefined) as RecurringExpenseProfile["frequency"] })} className={inputClass}><FrequencyOptions /></select></Field><Field label="Optional due date" error={state.errors[`recurringExpenses.${index}.dueDate`]}><input type="date" value={row.dueDate ?? ""} onChange={(event) => patch(expenseSetter(setRecurringExpenses), row.id, { dueDate: event.target.value || undefined })} className={inputClass} /></Field></div><Remove onClick={() => remove(expenseSetter(setRecurringExpenses), row.id)} label={`Remove recurring expense ${index + 1}`} /></article>)}
      <ErrorMessage message={state.errors.recurringExpenses} />
      <AddButton onClick={() => add(expenseSetter(setRecurringExpenses), { name: "" })}>Add recurring expense</AddButton>
    </section>

    <section className="space-y-4" aria-labelledby="savings-heading">
      <SectionHeading id="savings-heading" title="Savings allocations and safety targets" description="Allocations describe planned savings; they are not account balances or observed transfers." />
      {hiddenRows("savingsAllocations", savingsAllocations)}
      {savingsAllocations.map((row, index) => <article key={row.id} className={cardClass} aria-label={`Savings allocation ${index + 1}`}><div className="grid gap-3 sm:grid-cols-3"><Field label={`Allocation ${index + 1} name`}><input value={row.name} onChange={(event) => patch(savingsSetter(setSavingsAllocations), row.id, { name: event.target.value })} placeholder="Example: Emergency fund" className={inputClass} /></Field><Field label="Amount" error={state.errors[`savingsAllocations.${index}.amount`]}><input type="number" min="0" step="0.01" value={amount(row.amount)} onChange={(event) => patch(savingsSetter(setSavingsAllocations), row.id, { amount: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="Unknown" className={inputClass} /></Field><Field label="Frequency"><select value={row.frequency ?? ""} onChange={(event) => patch(savingsSetter(setSavingsAllocations), row.id, { frequency: (event.target.value || undefined) as SavingsAllocationProfile["frequency"] })} className={inputClass}><FrequencyOptions includePerPaycheck /></select></Field></div><Remove onClick={() => remove(savingsSetter(setSavingsAllocations), row.id)} label={`Remove savings allocation ${index + 1}`} /></article>)}
      <ErrorMessage message={state.errors.savingsAllocations} />
      <AddButton onClick={() => add(savingsSetter(setSavingsAllocations), { name: "" })}>Add savings allocation</AddButton>
      <div className="grid gap-4 rounded-xl border border-[var(--border)] p-4 sm:grid-cols-2"><Field label="Emergency-fund target" error={state.errors.emergencyFundTarget}><input name="emergencyFundTarget" type="number" min="0" step="0.01" defaultValue={amount(profile.savingsTargets?.emergencyFund)} placeholder="Unknown" className={inputClass} /></Field><Field label="Minimum cash buffer" error={state.errors.minimumCashBuffer}><input name="minimumCashBuffer" type="number" min="0" step="0.01" defaultValue={amount(profile.savingsTargets?.minimumCashBuffer)} placeholder="Unknown" className={inputClass} /></Field></div>
    </section>

    <section className="space-y-4" aria-labelledby="goals-heading">
      <SectionHeading id="goals-heading" title="Financial goals" description="Set targets only when you have one. A missing target remains unknown." />
      {hiddenRows("goals", goals)}
      {goals.map((row, index) => <article key={row.id} className={cardClass} aria-label={`Financial goal ${index + 1}`}><div className="grid gap-3 sm:grid-cols-3"><Field label={`Goal ${index + 1} name`}><input value={row.name} onChange={(event) => patch(goalSetter(setGoals), row.id, { name: event.target.value })} placeholder="Example: Build an emergency fund" className={inputClass} /></Field><Field label="Target amount" error={state.errors[`goals.${index}.targetAmount`]}><input type="number" min="0" step="0.01" value={amount(row.targetAmount)} onChange={(event) => patch(goalSetter(setGoals), row.id, { targetAmount: event.target.value === "" ? undefined : Number(event.target.value) })} placeholder="Unknown" className={inputClass} /></Field><Field label="Target date" error={state.errors[`goals.${index}.targetDate`]}><input type="date" value={row.targetDate ?? ""} onChange={(event) => patch(goalSetter(setGoals), row.id, { targetDate: event.target.value || undefined })} className={inputClass} /></Field></div><Remove onClick={() => remove(goalSetter(setGoals), row.id)} label={`Remove financial goal ${index + 1}`} /></article>)}
      <ErrorMessage message={state.errors.goals} />
      <AddButton onClick={() => add(goalSetter(setGoals), { name: "" })}>Add financial goal</AddButton>
    </section>

    <p className="text-sm leading-6 text-[var(--text-muted)]">Blank values stay unknown. Manually entered balances are distinct from imported account records. The app does not convert currencies, so combined totals should use a single currency.</p>
    <button disabled={pending} className="rounded-lg bg-[var(--accent)] px-5 py-3 font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : mode === "onboarding" ? "Save profile and continue" : "Save changes"}</button>
  </form>;
}

function incomeSourcesSetter(setter: Setter<IncomeSource>) { return setter; }
function financialAccountsSetter(setter: Setter<FinancialAccountProfile>) { return setter; }
function retirementSetter(setter: Setter<RetirementContributionProfile>) { return setter; }
function debtSetter(setter: Setter<DebtProfile>) { return setter; }
function expenseSetter(setter: Setter<RecurringExpenseProfile>) { return setter; }
function savingsSetter(setter: Setter<SavingsAllocationProfile>) { return setter; }
function goalSetter(setter: Setter<FinancialGoalProfile>) { return setter; }
function budgetSetter(setter: Setter<BudgetRow>) { return setter; }

function patchContribution(setter: Setter<RetirementContributionProfile>, id: string, values: Record<string, unknown>) {
  setter((rows) => rows.map((row) => row.id === id ? { ...row, contribution: { ...row.contribution, ...values } as RetirementContributionProfile["contribution"] } : row));
}

function SectionHeading({ id, title, description }: { id: string; title: string; description: string }) {
  return <header><h2 id={id} className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{description}</p></header>;
}

function FrequencyOptions({ includeOther = false, includePerPaycheck = false }: { includeOther?: boolean; includePerPaycheck?: boolean }) {
  return <><option value="">Not entered</option><option value="weekly">Weekly</option><option value="biweekly">Every two weeks</option><option value="semimonthly">Twice monthly</option><option value="monthly">Monthly</option><option value="annual">Annual</option><option value="irregular">Irregular / variable</option>{includeOther && <option value="other">Other / unspecified</option>}{includePerPaycheck && <option value="per-paycheck">Per paycheck</option>}</>;
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5 text-sm font-medium">{label}{children}{hint && <span className="block text-xs font-normal text-[var(--text-muted)]">{hint}</span>}{error && <span role="alert" className="block text-xs font-normal text-rose-700">{error}</span>}</label>;
}

function ErrorMessage({ message }: { message?: string }) { return message ? <p role="alert" className="text-sm text-rose-700">{message}</p> : null; }
function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={secondaryButton}>{children}</button>; }
function Remove({ onClick, label }: { onClick: () => void; label: string }) { return <button type="button" aria-label={label} onClick={onClick} className={`${secondaryButton} mt-3`}>Remove</button>; }

const cardClass = "rounded-xl border border-[var(--border)] bg-white p-4";
const inputClass = "mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]";
const secondaryButton = "rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium hover:bg-[var(--surface)]";
