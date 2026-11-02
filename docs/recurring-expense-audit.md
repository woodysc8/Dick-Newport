# Recurring expense calculation audit

## Existing representations and overlap

- `recurringExpenses` is the generalized profile collection. It records individual known or unknown amounts and their frequencies.
- `bills.monthlyObligations` and its `total` are a separate legacy bill plan. The dashboard currently shows that legacy total in the HYSA/bills panel, and shows `perPaycheckAllocation` separately. Those values are not monthly expense rows.
- `budget.monthlySpendingTarget` is an overall spending target. `budget.expenses` are category-level monthly budget lines, not necessarily fixed obligations. They are used by the legacy budget model and are not added to recurring expenses.
- `weeklySpending.weeklyTarget` and paycheck weekly/bills allocations are planning targets or allocations, not expenses. Adding them to obligations would double count planned spending.
- `debts` stores balances and optional payment fields. The recurring expense adapter reads only `recurringExpenses`; debt balances and payments are not automatically added.
- Retirement contribution plans and paycheck contribution preferences stay outside the expense estimate, since take-home income is already net and may already reflect payroll deductions.
- Actual transaction spending is calculated by accounting from classified transactions and remains separate from these profile-based estimates.

## Precedence and compatibility

If `recurringExpenses` is present, including an empty array, it alone determines the recurring expense estimate. It does not combine with legacy bills or budget category targets. An explicit empty collection is a complete zero recurring-expense estimate.

If the collection is absent, the adapter returns an unavailable estimate. Existing legacy bills, budget targets, weekly spending, paycheck allocations, and actual transaction totals continue to be presented through their prior dashboard fields. They are not rewritten to zero or treated as new recurring expense records.

## Frequency and incomplete values

The adapter shares the income adapter's annualized calendar-year conversion helper: weekly × 52 ÷ 12, biweekly × 26 ÷ 12, semimonthly × 24 ÷ 12, monthly unchanged, and annual ÷ 12. Irregular or unsupported frequencies are excluded. Unknown amounts remain excluded and visible; explicit zero is included. Negative or non-finite values are flagged by the adapter and rejected by profile validation.

The total sums only eligible records. A non-empty collection with no eligible known record has an unavailable total, not a fabricated zero. When some records are eligible and others excluded, the total is partial and the excluded records retain their names and reasons.
