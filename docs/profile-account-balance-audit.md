# Profile account balance audit

## Current balance sources

- Connected account records in `accounts` provide `current_balance`; `accounting.summarizeAccounts` classifies supported connected rows and treats an unknown supported balance as unavailable. Credit balances represent amounts owed and are subtracted from net worth.
- Legacy `manualBalances` are rendered as separate cash/savings estimates and were not included in connected net worth.
- `financialAccounts` provides profile-described balances with `balanceSource` values `manual`, `imported`, or `unknown`. Before this integration, the collection was normalized and validated but not used in dashboard balance totals.
- Dashboard connected accounts have database/Plaid IDs. Profile account rows have no stable identity key or connected account ID, so reliable matching is unavailable. Name or institution similarity is not used to deduplicate.
- Income estimates, expense estimates, paycheck allocations, retirement contributions, debt payments, and transactions are not account balances.

## Implemented precedence and arithmetic

- With `financialAccounts` absent, preserve the prior connected-only net worth. Legacy `manualBalances` remain in their separate estimate panel.
- With `financialAccounts` configured, including `[]`, add its supported known balances to the connected-account totals. The configured collection takes precedence over legacy `manualBalances`; the latter are not added. Connected and profile rows remain separate even when names look alike.
- `cash` and `depository` balances are assets. `investment` and `retirement` balances are investments. `credit` and `loan` balances are liabilities, subtracted from assets. Debt payments are not balance inputs.
- Manual and profile-imported rows are both profile-source values and are labeled separately from connected accounts. No currency conversion is performed.
- Missing, invalid, unknown-source, and unsupported account balances are listed and mark the profile total incomplete. Missing known-category totals stay unavailable rather than being coerced to zero. Explicit `0` remains a known balance.

`LEGACY_EXAMPLE_FINANCIAL_PROFILE` remains unchanged. Actual transactions and profile-based income/expense estimates retain their existing separate calculations.
