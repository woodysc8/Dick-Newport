import { describe, expect, it } from "vitest";
import { buildDashboardViewModel, buildPortfolioGrowthSeries, isCashHolding } from "./dashboardViewModel";
import { DashboardAccount, InvestmentHolding, InvestmentSnapshot, RecentTransaction } from "./dashboard";
import { LEGACY_EXAMPLE_FINANCIAL_PROFILE, STARTER_FINANCIAL_PROFILE } from "./financialProfileDefaults";

function account(overrides: Partial<DashboardAccount>): DashboardAccount {
  return {
    id: "account-id",
    institution_name: "Robinhood",
    account_name: "Robinhood Individual",
    mask: null,
    account_type: "investment",
    account_subtype: "brokerage",
    current_balance: 500,
    available_balance: 400,
    plaid_account_id: "individual-id",
    ...overrides,
  };
}

function holding(overrides: Partial<InvestmentHolding>): InvestmentHolding {
  return {
    id: "holding-id",
    plaid_account_id: "individual-id",
    security_id: "security-id",
    ticker_symbol: "VOO",
    security_name: "Vanguard S&P 500 ETF",
    quantity: 1,
    institution_price: 100,
    institution_value: 100,
    cost_basis: 90,
    ...overrides,
  };
}

function snapshot(overrides: Partial<InvestmentSnapshot>): InvestmentSnapshot {
  return {
    id: "snapshot-id",
    plaid_item_id: "item-id",
    plaid_account_id: "individual-id",
    snapshot_date: "2026-01-01",
    portfolio_value: 100,
    created_at: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

const accounts = [
  account({}),
  account({ id: "roth-account", account_name: "Robinhood Roth IRA", account_subtype: "roth", plaid_account_id: "roth-id" }),
];
const emptyTransactions: RecentTransaction[] = [];

describe("buildPortfolioGrowthSeries", () => {
  it("sorts observations chronologically and combines duplicate dates", () => {
    const series = buildPortfolioGrowthSeries([
      snapshot({ snapshot_date: "2026-01-03", portfolio_value: 120, securities_value: 120 }),
      snapshot({ snapshot_date: "2026-01-01", portfolio_value: 100, securities_value: 100 }),
      snapshot({ snapshot_date: "2026-01-03", portfolio_value: 80, securities_value: 80, plaid_account_id: "roth-id" }),
    ], accounts);

    expect(series.observations).toEqual([
      { date: "2026-01-01", value: 100 },
      { date: "2026-01-03", value: 200 },
    ]);
  });

  it("aggregates taxable and Roth snapshots and calculates the earliest-to-latest change", () => {
    const series = buildPortfolioGrowthSeries([
      snapshot({ snapshot_date: "2026-01-01", portfolio_value: 100, securities_value: 100 }),
      snapshot({ snapshot_date: "2026-01-01", portfolio_value: 50, securities_value: 50, plaid_account_id: "roth-id" }),
      snapshot({ snapshot_date: "2026-02-01", portfolio_value: 180, securities_value: 180 }),
      snapshot({ snapshot_date: "2026-02-01", portfolio_value: 70, securities_value: 70, plaid_account_id: "roth-id" }),
    ], accounts);

    expect(series.latestValue).toBe(250);
    expect(series.changeSinceFirstSnapshot).toBe(100);
  });

  it("returns no observations when stored snapshots include cash", () => {
    const series = buildPortfolioGrowthSeries([snapshot({ portfolio_value: 500 })], accounts);

    expect(series.observations).toEqual([]);
    expect(series.changeSinceFirstSnapshot).toBeNull();
  });

  it("represents insufficient history without fabricating observations", () => {
    const series = buildPortfolioGrowthSeries([snapshot({ portfolio_value: 100, securities_value: 100 })], accounts);

    expect(series.observations).toHaveLength(1);
  });
});

describe("cash-aware portfolio positions", () => {
  it("keeps unset spending targets and bill amounts unknown for a blank profile", () => {
    const view = buildDashboardViewModel({
      accounts: [], monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: STARTER_FINANCIAL_PROFILE,
      now: new Date("2026-10-05T12:00:00.000Z"),
    });
    expect(view.spendingBudgetUsage).toBeNull();
    expect(view.financialPlan.bills.monthlyObligations.total).toBeUndefined();
    expect(view.overallPosition.connectedNetWorth).toBeNull();
    expect(view.overallPosition.netWorth).toBeNull();
  });

  it("preserves a legitimate zero net worth from supplied account information", () => {
    const view = buildDashboardViewModel({
      accounts: [account({ account_type: "depository", current_balance: 1000 }), account({ id: "credit", account_type: "credit", current_balance: 1000 })],
      monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: STARTER_FINANCIAL_PROFILE,
    });
    expect(view.overallPosition.connectedNetWorth).toBe(0);
    expect(view.overallPosition.netWorth).toBe(0);
  });

  it("does not add manually entered cash estimates to connected net worth", () => {
    const view = buildDashboardViewModel({
      accounts: [], monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: { ...STARTER_FINANCIAL_PROFILE, manualBalances: { cash: 5000, savings: 9000, source: "user-entered" } },
      now: new Date("2026-10-05T12:00:00.000Z"),
    });
    expect(view.overallPosition.netWorth).toBeNull();
    expect(view.profileAccountBalances.configured).toBe(false);
  });

  it("adds configured profile balances separately even when account names appear identical", () => {
    const view = buildDashboardViewModel({
      accounts: [account({ account_type: "depository", account_subtype: "checking", account_name: "Fictional checking", current_balance: 100 })],
      monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: { ...STARTER_FINANCIAL_PROFILE, financialAccounts: [{ name: "Fictional checking", accountType: "depository", subtype: "checking", balance: 100, balanceSource: "manual" }] },
    });
    expect(view.overallPosition.connectedNetWorth).toBe(100);
    expect(view.overallPosition.profileAccountNetWorth).toBe(100);
    expect(view.overallPosition.netWorth).toBe(200);
    expect(view.overallPosition.netWorthComplete).toBe(true);
  });

  it("does not add legacy manual balances on top of an explicitly empty account list", () => {
    const view = buildDashboardViewModel({
      accounts: [account({ account_type: "depository", account_subtype: "checking", current_balance: 500 })],
      monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: { ...STARTER_FINANCIAL_PROFILE, financialAccounts: [], manualBalances: { cash: 300, savings: 700, source: "user-entered" } },
    });
    expect(view.overallPosition.netWorth).toBe(500);
    expect(view.profileAccountBalances).toMatchObject({ configured: false, netWorth: null });
  });

  it("marks consolidated net worth incomplete when a configured account balance is unknown", () => {
    const view = buildDashboardViewModel({
      accounts: [account({ account_type: "depository", account_subtype: "checking", current_balance: 500 })],
      monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: { ...STARTER_FINANCIAL_PROFILE, financialAccounts: [{ name: "Unknown savings", accountType: "depository", subtype: "savings", balanceSource: "unknown" }] },
    });
    expect(view.overallPosition.netWorth).toBeNull();
    expect(view.overallPosition.netWorthComplete).toBe(false);
    expect(view.profileAccountBalances.excludedCount).toBe(1);
  });

  it("keeps net worth unknown when a connected account balance is null", () => {
    const view = buildDashboardViewModel({
      accounts: [account({ account_type: "depository", account_subtype: "checking", current_balance: null })],
      monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: STARTER_FINANCIAL_PROFILE,
      now: new Date("2026-10-05T12:00:00.000Z"),
    });
    expect(view.accountSummary.cash).toBeNull();
    expect(view.accountSummary.netWorth).toBeNull();
    expect(view.overallPosition.netWorth).toBeNull();
  });

  it("subtracts the positive amount owed on credit accounts from net worth", () => {
    const view = buildDashboardViewModel({
      accounts: [
        account({ account_type: "depository", account_subtype: "checking", current_balance: 1000 }),
        account({ id: "credit", account_type: "credit", account_subtype: "credit card", current_balance: 250 }),
      ],
      monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: STARTER_FINANCIAL_PROFILE,
      now: new Date("2026-10-05T12:00:00.000Z"),
    });
    expect(view.accountSummary.credit).toBe(250);
    expect(view.accountSummary.netWorth).toBe(750);
    expect(view.overallPosition.netWorth).toBe(750);
  });

  it("includes connected loan liabilities and retains unknown mixed liabilities as incomplete", () => {
    const view = buildDashboardViewModel({
      accounts: [
        account({ account_type: "depository", account_subtype: "checking", current_balance: 3000 }),
        account({ id: "loan", account_type: "loan", account_subtype: "student loan", current_balance: 1000 }),
        account({ id: "unknown-loan", account_type: "loan", account_subtype: "auto loan", current_balance: null }),
      ],
      monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: STARTER_FINANCIAL_PROFILE,
    });
    expect(view.accountSummary.credit).toBeNull();
    expect(view.overallPosition.netWorth).toBeNull();
    expect(view.overallPosition.netWorthComplete).toBe(false);
  });

  it("applies the profile pending-transaction preference to dashboard monthly totals", () => {
    const transactions = [
      { id: "posted", date: "2026-10-03", name: "Groceries", merchant_name: "Market", amount: 30, category: "Grocery", pending: false, plaid_transaction_id: "posted", account_id: null },
      { id: "pending", date: "2026-10-04", name: "Groceries", merchant_name: "Market", amount: 20, category: "Grocery", pending: true, plaid_transaction_id: "pending", account_id: null },
    ];
    const view = buildDashboardViewModel({
      accounts: [], monthTransactions: transactions, historicalTransactions: transactions, holdings: [], snapshots: [],
      profile: { ...STARTER_FINANCIAL_PROFILE, budgetingPreferences: { includePendingTransactions: false } },
      now: new Date("2026-10-05T12:00:00.000Z"),
    });
    expect(view.monthly.spending).toBe(30);
    expect(view.monthly.pendingSpending).toBe(0);
    expect(view.monthlyHistory.at(-1)?.spending).toBe(30);
  });

  it("uses a profile's category targets for the budget usage calculation", () => {
    const view = buildDashboardViewModel({
      accounts: [], monthTransactions: [{ id: "txn", date: "2026-10-03", name: "Groceries", merchant_name: "Market", amount: 250, category: "food", pending: false, plaid_transaction_id: "txn", account_id: null }], historicalTransactions: [], holdings: [], snapshots: [],
      profile: { ...STARTER_FINANCIAL_PROFILE, budget: { expenses: [{ name: "Food", category: "food", amount: 500 }] } },
      now: new Date("2026-10-05T12:00:00.000Z"),
    });
    expect(view.spendingBudgetUsage).toBe(50);
  });

  it("does not include Robinhood Individual CUR:USD in Equities invested value", () => {
    const view = buildDashboardViewModel({
      accounts: [account({})],
      monthTransactions: emptyTransactions,
      historicalTransactions: emptyTransactions,
      holdings: [
        holding({ institution_value: 100 }),
        holding({ id: "cash-holding", ticker_symbol: "CUR:USD", security_name: "CUR:USD", institution_value: 400, cost_basis: null }),
      ],
      snapshots: [],
      now: new Date("2026-10-05T12:00:00.000Z"),
    });

    expect(isCashHolding(holding({ ticker_symbol: "CUR:USD", security_name: "CUR:USD" }))).toBe(true);
    expect(view.financialPosition.equities.investedValue).toBe(100);
    expect(view.financialPosition.equities.cashValue).toBe(400);
    expect(view.financialPosition.equities.holdings).toHaveLength(1);
    expect(view.financialPosition.hysa.currentBalance).toBe(400);
  });

  it("exposes configured recurring income separately from actual transaction income", () => {
    const view = buildDashboardViewModel({
      accounts: [], monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: { ...STARTER_FINANCIAL_PROFILE, incomeSources: [{ name: "Fictional salary", type: "employment", amount: 1000, basis: "net", frequency: "biweekly", regularity: "regular", includeInBudgetEstimate: true }] },
    });
    expect(view.monthlyIncomeEstimate.estimatedMonthlyTakeHomeIncome).toBeCloseTo(2166.67, 2);
    expect(view.monthly.income).toBe(0);
  });

  it("uses the legacy monthly budget income when no source collection is configured", () => {
    const view = buildDashboardViewModel({
      accounts: [], monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: { ...STARTER_FINANCIAL_PROFILE, budget: { monthlyIncome: 500 } },
    });
    expect(view.monthlyIncomeEstimate).toMatchObject({ estimatedMonthlyTakeHomeIncome: 500, legacyFallbackUsed: true });
  });

  it("keeps all-excluded configured income unavailable without breaking dashboard cash-flow fields", () => {
    const view = buildDashboardViewModel({
      accounts: [], monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: {
        ...STARTER_FINANCIAL_PROFILE,
        incomeSources: [{ name: "Gross-only source", type: "employment", amount: 1000, basis: "gross", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true }],
      },
    });
    expect(view.monthlyIncomeEstimate).toMatchObject({ estimatedMonthlyTakeHomeIncome: null, status: "unavailable" });
    expect(view.financialPlan.estimatedRecurringCashFlow).toBeNull();
  });

  it("combines configured income and recurring expenses without changing actual cash flow", () => {
    const view = buildDashboardViewModel({
      accounts: [], monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: {
        ...STARTER_FINANCIAL_PROFILE,
        incomeSources: [
          { name: "Fictional salary", type: "employment", amount: 2000, basis: "net", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true },
          { name: "Fictional second job", type: "employment", amount: 1000, basis: "net", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true },
        ],
        recurringExpenses: [expenseRow("Rent", 1200), expenseRow("Utilities", 150)],
      },
    });
    expect(view.monthlyIncomeEstimate.estimatedMonthlyTakeHomeIncome).toBe(3000);
    expect(view.monthlyExpenseEstimate.estimatedMonthlyExpenses).toBe(1350);
    expect(view.financialPlan.estimatedRecurringCashFlow).toBe(1650);
    expect(view.financialPlan.recurringCashFlowComplete).toBe(true);
    expect(view.monthly.income).toBe(0);
    expect(view.monthly.spending).toBe(0);
  });

  it("keeps legacy bills visible without treating them as configured recurring expenses", () => {
    const view = buildDashboardViewModel({
      accounts: [], monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: LEGACY_EXAMPLE_FINANCIAL_PROFILE,
    });
    expect(view.financialPlan.bills.monthlyObligations.total).toBe(898);
    expect(view.monthlyExpenseEstimate.estimatedMonthlyExpenses).toBeNull();
    expect(view.financialPlan.estimatedRecurringCashFlow).toBeNull();
  });
});

function expenseRow(name: string, amount: number) {
  return { name, amount, frequency: "monthly" as const };
}
