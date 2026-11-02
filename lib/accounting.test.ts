import { describe, expect, it } from "vitest";
import accounting from "./accounting";
import { getDashboardAccountClass, type DashboardAccount } from "./dashboard";
import { classifyTransaction } from "./classifyTransaction";

type Transaction = {
  id?: string;
  plaid_transaction_id?: string | null;
  amount: number | string | null;
  name?: string | null;
  merchant_name?: string | null;
  category?: string | string[] | null;
  pending?: boolean | null;
  account_id?: string | null;
};

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return { amount: 0, ...overrides };
}

function account(overrides: Partial<DashboardAccount> = {}): DashboardAccount {
  return {
    id: "account",
    institution_name: "Example Bank",
    account_name: "Example Account",
    mask: null,
    account_type: "depository",
    account_subtype: "checking",
    current_balance: 0,
    available_balance: null,
    currency: "USD",
    ...overrides,
  };
}

describe("accounting foundation regression cases", () => {
  it("adds multiple checking and savings balances and subtracts positive credit debt", () => {
    const summary = accounting.summarizeAccounts([
      account({ current_balance: 1200 }),
      account({ id: "checking-2", current_balance: 300 }),
      account({ id: "savings", account_subtype: "savings", current_balance: 2500 }),
      account({ id: "card", account_type: "credit", account_subtype: "credit card", current_balance: 400 }),
    ]);
    expect(summary.cash).toBe(4000);
    expect(summary.credit).toBe(400);
    expect(summary.netWorth).toBe(3600);
  });

  it("preserves single-currency connected totals", () => {
    const summary = accounting.summarizeAccounts([
      account({ current_balance: 1200, currency: "USD" }),
      account({ id: "savings", current_balance: 800, currency: "USD" }),
      account({ id: "card", account_type: "credit", current_balance: 200, currency: "USD" }),
    ]);
    expect(summary.currency).toBe("USD");
    expect(summary.cash).toBe(2000);
    expect(summary.credit).toBe(200);
    expect(summary.netWorth).toBe(1800);
  });

  it("keeps an empty connected account set unavailable", () => {
    expect(accounting.summarizeAccounts([])).toMatchObject({
      configured: false,
      netWorth: null,
    });
  });

  it("includes positive loans and applies the credit-card sign convention", () => {
    const summary = accounting.summarizeAccounts([
      account({ current_balance: 1000 }),
      account({ id: "loan", account_type: "loan", account_subtype: "student loan", current_balance: 2500 }),
      account({ id: "card", account_type: "credit", account_subtype: "credit card", current_balance: 400 }),
      account({ id: "credit-balance", account_type: "credit", account_subtype: "credit card", current_balance: -100 }),
    ]);
    expect(summary.credit).toBe(2800);
    expect(summary.netWorth).toBe(-1800);
  });

  it("keeps a negative loan balance unknown instead of treating it as a credit", () => {
    expect(accounting.summarizeAccounts([
      account({ account_type: "loan", account_subtype: "student loan", current_balance: -100 }),
    ])).toMatchObject({ credit: null, netWorth: null });
  });

  it("keeps common retirement subtypes distinguishable while aggregating their balances", () => {
    const retirement = [
      ["traditional 401k", "401k"],
      ["Roth 401k", "roth 401k"],
      ["traditional IRA", "traditional ira"],
      ["Roth IRA", "roth ira"],
    ] as const;
    const accounts = retirement.map(([name, subtype], index) => account({
      id: `retirement-${index}`, account_type: "investment", account_name: name,
      account_subtype: subtype, current_balance: (index + 1) * 1000,
    }));
    accounts.push(account({ id: "brokerage", account_type: "investment", account_name: "Taxable brokerage", account_subtype: "brokerage", current_balance: 5000 }));

    expect(accounts.map(getDashboardAccountClass)).toEqual(["retirement", "retirement", "retirement", "retirement", "investment"]);
    expect(accounting.summarizeAccounts(accounts).investments).toBe(15000);
  });

  it("counts recognizable payroll inflows but leaves bonus and side income for review", () => {
    const salary = tx({ amount: -2500, name: "ACME Payroll" });
    const bonus = tx({ amount: -900, name: "Annual Bonus" });
    const sideIncome = tx({ amount: -300, name: "Weekend project payment" });
    const result = accounting.computeMonthlyAccounting([salary, bonus, sideIncome]);
    expect(result.income).toBe(2500);
    expect(classifyTransaction(bonus).financial_type).toBe("unknown");
    expect(classifyTransaction(sideIncome).financial_type).toBe("unknown");
  });

  it("does not classify an outgoing payroll-like charge as income", () => {
    const outgoing = tx({ amount: 50, name: "Payroll service fee" });
    expect(accounting.computeMonthlyAccounting([outgoing]).income).toBe(0);
    expect(classifyTransaction(outgoing).financial_type).not.toBe("income");
  });

  it("keeps both linked transfer legs out of income and spending", () => {
    const result = accounting.computeMonthlyAccounting([
      tx({ amount: 500, name: "Transfer to savings" }),
      tx({ amount: -500, name: "Transfer from checking" }),
    ]);
    expect(result).toMatchObject({ income: 0, spending: 0, transfers: 1000 });
  });

  it("counts a card purchase once and excludes the later card repayment from spending", () => {
    const result = accounting.computeMonthlyAccounting([
      tx({ amount: 100, merchant_name: "Market Basket", category: "Groceries" }),
      tx({ amount: 100, name: "Credit Card Payment" }),
    ]);
    expect(result.spending).toBe(100);
    expect(result.creditCardPayments).toBe(100);
  });

  it("keeps refunds and the recognized small Venmo reimbursement out of income", () => {
    const result = accounting.computeMonthlyAccounting([
      tx({ amount: 80, merchant_name: "Cafe", category: "Restaurant" }),
      tx({ amount: -25, name: "Cafe Refund", category: "Restaurant" }),
      tx({ amount: -20, name: "Venmo payment", merchant_name: "Venmo", pending: false }),
    ]);
    expect(result.income).toBe(0);
    expect(result.refunds).toBe(25);
    expect(result.spending).toBe(35);
    expect(result.grossSpending).toBe(80);
  });

  it("keeps a debit reversal labeled as a refund in outflows instead of discarding it", () => {
    const result = accounting.computeMonthlyAccounting([
      tx({ amount: 15, name: "Refund reversal", category: "Shopping" }),
    ]);
    expect(result.refunds).toBe(0);
    expect(result.grossSpending).toBe(15);
    expect(result.spending).toBe(15);
  });

  it("uses the explicit pending preference and preserves the existing default", () => {
    const transactions = [
      tx({ amount: 60, name: "Posted grocery", category: "Groceries", pending: false }),
      tx({ amount: 40, name: "Pending grocery", category: "Groceries", pending: true }),
    ];
    expect(accounting.computeMonthlyAccounting(transactions).spending).toBe(100);
    expect(accounting.computeMonthlyAccounting(transactions, [], { includePending: false }).spending).toBe(60);
  });

  it("keeps missing or invalid balances unknown rather than converting them to zero", () => {
    expect(accounting.summarizeAccounts([account({ current_balance: null })]).cash).toBeNull();
    expect(accounting.summarizeAccounts([account({ current_balance: "not-a-number" })]).cash).toBeNull();
  });

  it("keeps connected totals separate by currency", () => {
    const summary = accounting.summarizeAccounts([
      account({ current_balance: 100, currency: "USD" }),
      account({ id: "eur", current_balance: 200, currency: "EUR" }),
    ]);
    expect(summary.netWorth).toBeNull();
    expect(summary.currencyTotals.USD.cash).toBe(100);
    expect(summary.currencyTotals.EUR.cash).toBe(200);
    expect(summary.mixedCurrency).toBe(true);
  });

  it("marks transaction totals unsafe when linked accounts use different currencies", () => {
    const result = accounting.computeMonthlyAccounting([
      tx({ account_id: "usd", amount: 10, category: "Groceries" }),
      tx({ account_id: "eur", amount: 20, category: "Groceries" }),
    ], [
      account({ id: "usd", currency: "USD" }),
      account({ id: "eur", currency: "EUR" }),
    ]);
    expect(result.mixedCurrency).toBe(true);
    expect(result.currencySafe).toBe(false);
  });

  it("does not assign a currency to transactions whose linked account currency is missing", () => {
    const result = accounting.computeMonthlyAccounting([
      tx({ account_id: "unknown", amount: 10, category: "Groceries" }),
    ], [account({ id: "unknown", currency: null })]);
    expect(result.currency).toBeNull();
    expect(result.unknownCurrency).toBe(true);
    expect(result.currencySafe).toBe(false);
  });

  it("includes a large one-off purchase alongside regular bills in spending", () => {
    const result = accounting.computeMonthlyAccounting([
      tx({ amount: 1200, name: "Monthly rent", category: "Rent" }),
      tx({ amount: 75, name: "Electric bill", category: "Utilities" }),
      tx({ amount: 2400, name: "Laptop purchase", category: "Shopping" }),
    ]);
    expect(result.spending).toBe(3675);
  });

  it("sums three actual biweekly salary deposits in a three-paycheck month", () => {
    const paychecks = [1, 2, 3].map((index) => tx({ amount: -1800, name: `Employer payroll ${index}` }));
    expect(accounting.computeMonthlyAccounting(paychecks).income).toBe(5400);
  });

  it("leaves ambiguous transactions unclassified instead of asserting income or spending", () => {
    const ambiguous = tx({ amount: -425, name: "Adjustment 4812" });
    expect(classifyTransaction(ambiguous).financial_type).toBe("unknown");
    expect(accounting.computeMonthlyAccounting([ambiguous])).toMatchObject({ income: 0, spending: 0 });
  });

  it("deduplicates exact provider transaction IDs but cannot infer unmatched IDs", () => {
    const repeated = tx({ amount: 32, merchant_name: "Coffee Shop", plaid_transaction_id: "plaid-txn-1" });
    const result = accounting.computeMonthlyAccounting([
      repeated,
      { ...repeated, id: "duplicate-row" },
      tx({ amount: 32, merchant_name: "Coffee Shop" }),
    ]);
    expect(result.spending).toBe(64);
  });
});
