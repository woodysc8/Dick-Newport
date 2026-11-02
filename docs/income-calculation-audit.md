# Income calculation audit

## Existing behavior

- Transaction income comes from `accounting.computeMonthlyAccounting` and is used for actual monthly cash flow, savings rate, and six-month history in the dashboard. It is derived from classified transactions and is independent of profile estimates.
- The legacy `income` value is presented as an income assumption in the financial plan; `paychecks` supplies per-paycheck plan amounts and payday schedule.
- `budget.monthlyIncome` is the input to `getMonthlyBudget` / `getBudgetedIncome` and savings calculation. No other code previously combined it with `income` or `paychecks`.
- Normalization retains legacy fields and gives a configured collection precedence. Absence and explicit emptiness must remain distinct.

## Implemented precedence

1. If `incomeSources` is configured, including `[]`, only that collection feeds the recurring monthly estimate. Eligible opted-in net sources are added; legacy income, paychecks, and `budget.monthlyIncome` are not added on top. An empty collection yields a complete zero estimate.
2. If `incomeSources` is absent, preserve the prior budget model's value from `budget.monthlyIncome` as the legacy fallback. If that value is unknown, the estimate is unavailable. Legacy `income` and `paychecks` keep their existing plan behavior and do not become budget income implicitly.
3. Actual transaction income remains separate and is labeled as actual transactions in cash flow.

The dashboard shows the estimate in the Financial Plan panel. The Recent Financial Rhythm panel and its history chart continue to show transaction-derived actual income and spending.

## Source eligibility and conversion

The estimate includes only sources explicitly opted in, with finite nonnegative known amounts, net basis, regularity `regular`, and a supported recurring frequency. Gross, unknown/invalid, irregular, unsupported, and opted-out sources are reported with exclusion reasons. Partial results include eligible amounts and list every excluded source.

Annualized calendar-year averages use 52 weekly periods, 26 biweekly periods, and 24 semimonthly periods divided by 12. Monthly stays unchanged; annual is divided by 12. Irregular and `other` frequencies are unsupported. These are budgeting estimates, not tax calculations or advice.
