import { describe, expect, it } from "vitest";
import { buildDashboardViewModel, buildPortfolioGrowthSeries, isCashHolding } from "./dashboardViewModel";
import { DashboardAccount, InvestmentHolding, InvestmentSnapshot, RecentTransaction } from "./dashboard";
import { STARTER_FINANCIAL_PROFILE } from "./financialProfileDefaults";

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
  });

  it("does not add manually entered cash estimates to connected net worth", () => {
    const view = buildDashboardViewModel({
      accounts: [], monthTransactions: [], historicalTransactions: [], holdings: [], snapshots: [],
      profile: { ...STARTER_FINANCIAL_PROFILE, manualBalances: { cash: 5000, savings: 9000, source: "user-entered" } },
      now: new Date("2026-10-05T12:00:00.000Z"),
    });
    expect(view.overallPosition.netWorth).toBe(0);
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
});
