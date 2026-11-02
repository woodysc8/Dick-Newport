# Accounting foundation audit

This note records the behavior verified and changes made during the accounting foundation pass. It does not replace the legacy financial example or change any of its values.

## Current accounting conventions

- Plaid transaction amounts use this application's convention: positive values are outflows; negative values are inflows.
- Account balances are summed by broad accounting bucket. Retirement and brokerage accounts retain their original subtype/account records and are separately classified in the dashboard; the aggregate investments total intentionally combines their balances.
- Credit balances are represented as positive amounts owed and are subtracted from net worth.
- Credit-card payments, transfers, and investment activity remain separate from regular budget spending. A card purchase is spending; its later repayment is not.
- Unknown transactions remain unclassified by the fallback classifier. Income name/category matching is now limited to inflows, so an outgoing payroll-like charge cannot be income.
- Exact duplicate rows with the same non-empty Plaid transaction ID are ignored in monthly aggregation. Rows without a provider ID cannot be deduplicated safely.
- Pending transactions remain included by default for backward compatibility. The profile's `includePendingTransactions: false` preference now excludes them from monthly, historical, and weekly spending totals.
- Monthly `grossSpending` retains gross purchases. `spending` is net of identified incoming refunds and the existing recognized Venmo reimbursement rule; refunds remain reported separately. Refunds lower a category only when the existing transaction category maps to one.
- Monthly income uses posted transaction amounts as supplied in the current query. Monthly budget conversion for biweekly pay is an annualized average; actual transactions can yield three paychecks in an individual month.

## Limits that remain

- Transaction classification still relies heavily on merchant/name and Plaid-category heuristics. Bonus, side income, and generic expense reimbursements may remain `unknown` pending user review. No arbitrary negative deposit is treated as income.
- A recognized P2P reimbursement is limited to the existing Venmo heuristic. There is no robust source/destination or linked-purchase metadata to distinguish all reimbursements from gifts, transfers, or income.
- Transfer legs are excluded from income and spending, but the `transfers` metric sums the absolute value of each row. A matched pair therefore represents gross transfer flow, not a deduplicated unique transfer amount.
- The dashboard query does not load Plaid's pending-to-posted linkage. If a pending transaction and its posted replacement have different IDs and both are present, exact-ID deduplication cannot identify them as one event.
- Refund linkage to the original purchase is not available. Monthly totals apply an identified refund in its posted month; historical spend is not restated against the original purchase month. Unmapped refund categories reduce total net spending but do not alter a budget category.
- Account and transaction records may contain different currencies. The current aggregation does not perform currency conversion and should not be treated as a reliable combined total across currencies.
- Investment activity is classified as a separate transaction flow; this is not investment performance or a retirement projection.

## Intentional behavior changes in this pass

1. A payroll-like transaction is counted as income only when its amount is an inflow.
2. The pending preference is honored consistently by monthly, historical, and weekly spending calculations; an unset preference preserves the prior inclusion behavior.
3. Exact duplicate transaction rows sharing a provider ID no longer inflate monthly totals.
4. Monthly spending now nets identified incoming refunds, aligning its net-spending meaning with the weekly calculation; gross spending and the separate refund amount remain available.

