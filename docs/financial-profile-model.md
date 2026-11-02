# Financial profile collections

`FinancialProfile` retains its existing single-value properties for current dashboard calculations and adds optional collections for multiple income sources, manually described/imported financial accounts, and retirement contribution plans. Existing debt and recurring-expense arrays have been extended without removing their prior fields. Savings allocations and goals remain arrays.

`normalizeFinancialProfile` is a pure adapter for legacy records. It keeps legacy properties intact, represents known single values in the new collections, and leaves unknown amounts absent. If a collection property exists, it takes precedence even when it is empty; this lets a user intentionally remove all records without the legacy version reappearing on the next load. Legacy manual cash/savings balances are converted only when the financial-account collection is absent. A legacy contribution with both a fixed amount and percentage is marked `legacy-unresolved`; the adapter does not add the two values together or assume their relationship. The helper is deterministic and safe to call repeatedly.

Amounts retain their semantics: income basis is gross or net; percentage contributions identify whether the percentage applies to gross income, net income, or is unresolved; account balance source distinguishes manual, imported, and unknown; debt interest is explicitly annual; recurring amounts keep their entered frequency. A missing number remains unknown, while zero remains an entered value. The profile currency is descriptive; no currency conversion is performed.

`validateFinancialProfileCollections` provides non-mutating validation for collection values. It allows negative cash, depository, or credit balances (for example, an overdraft or an account credit), while other account types and profile income, contributions, debts, expenses, allocations, and goals reject negative amounts. This validation is connected to the authenticated save path; no database migration is required.

## Compatibility limit

The current dashboard still reads the legacy paycheck, Roth plan, and budget fields. The normalizer retains those fields and does not derive dashboard values from the new collections. The profile form collects the new records, but dashboard calculations do not yet consume them.
