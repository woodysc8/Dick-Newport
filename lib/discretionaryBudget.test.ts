import { describe, expect, it } from "vitest";
import {
  accountSources,
  normalizePlaidCategory,
  transactionDecision,
  weeklyMetrics,
  weekPeriod,
  type BudgetAccount,
  type BudgetTransaction,
} from "./discretionaryBudget";
export const account: BudgetAccount = {
  id: "a",
  account_name: "Checking",
  institution_name: "Test",
  currency: "USD",
  persistent_account_id: null,
  weekly_budget_source: "include",
  created_at: "2026-01-01",
};
export const transaction = (
  changes: Partial<BudgetTransaction> = {},
): BudgetTransaction => ({
  id: "t",
  account_id: "a",
  plaid_transaction_id: "p",
  date: "2026-11-11",
  name: "Purchase",
  merchant_name: null,
  amount: 10,
  pending: false,
  category: null,
  normalized_category: "dining",
  category_override: null,
  weekly_budget_override: null,
  transaction_currency: "USD",
  pending_transaction_id: null,
  plaid_primary_category: "FOOD_AND_DRINK",
  plaid_detailed_category: null,
  plaid_category_confidence: "HIGH",
  ...changes,
});
const now = new Date("2026-11-11T17:00:00Z");
const metrics = (
  rows: BudgetTransaction[],
  limit: number | null = 100,
  accounts: BudgetAccount[] = [account],
) => weeklyMetrics(rows, accounts, limit, now);
it("fits two different budget personas without inventing refund allowance", () => {
  const first = metrics([
    transaction({ amount: 120 }),
    transaction({
      id: "pending",
      plaid_transaction_id: "pending",
      amount: 15,
      pending: true,
    }),
    transaction({
      id: "credit",
      plaid_transaction_id: "credit",
      amount: -1000,
    }),
  ]);
  expect(first).toMatchObject({
    posted: 120,
    remaining: -20,
    pending: 15,
    unmatchedCredits: 1000,
  });
  const second = metrics(
    [
      transaction({ transaction_currency: "EUR", amount: 20 }),
      transaction({
        id: "review",
        plaid_transaction_id: "review",
        normalized_category: "needs_review",
        amount: 5,
      }),
      transaction({
        id: "payment",
        plaid_transaction_id: "payment",
        normalized_category: "card_payment",
        amount: 50,
      }),
    ],
    null,
  );
  expect(second).toMatchObject({
    posted: 0,
    remaining: null,
    currencyCount: 1,
    review: 5,
    excluded: 50,
  });
});
describe("New York calendar weeks", () => {
  it.each([
    ["2026-03-09T03:59:59Z", "2026-03-02"],
    ["2026-03-09T04:00:00Z", "2026-03-09"],
    ["2026-11-02T04:59:59Z", "2026-10-26"],
    ["2026-11-02T05:00:00Z", "2026-11-02"],
    ["2027-01-04T05:00:00Z", "2027-01-04"],
  ])("uses local Monday boundaries through DST: %s", (date, start) =>
    expect(weekPeriod(new Date(date)).start).toBe(start),
  );
  it("includes Sunday, excludes next Monday, and uses posted date rather than insertion", () => {
    expect(
      metrics([
        transaction({ date: "2026-11-15" }),
        transaction({
          id: "other",
          plaid_transaction_id: "other",
          date: "2026-11-16",
        }),
      ]).posted,
    ).toBe(10);
  });
});
describe("conservative discretionary classification", () => {
  it.each([
    ["FOOD_AND_DRINK", "FOOD_AND_DRINK_COFFEE", "coffee"],
    ["FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES", "groceries"],
    ["GENERAL_MERCHANDISE", "GENERAL_MERCHANDISE_OTHER", "shopping"],
    ["ENTERTAINMENT", "ENTERTAINMENT_SPORTS", "entertainment"],
    ["TRANSFER_OUT", "TRANSFER_OUT_COFFEE", "transfer"],
    ["LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "card_payment"],
    ["LOAN_PAYMENTS", "LOAN_PAYMENTS_MORTGAGE_PAYMENT", "housing"],
    ["INCOME", "INCOME_WAGES", "income"],
  ])("maps high confidence %s / %s", (primary, detailed, expected) =>
    expect(normalizePlaidCategory(primary, detailed, "HIGH")).toBe(expected),
  );
  it.each([null, "LOW", "MEDIUM", "UNKNOWN"])(
    "reviews unknown or lower confidence: %s",
    (confidence) =>
      expect(
        normalizePlaidCategory(
          "FOOD_AND_DRINK",
          "FOOD_AND_DRINK_COFFEE",
          confidence,
        ),
      ).toBe("needs_review"),
  );
  it("does not use merchant descriptions to include transfers or card payments", () => {
    for (const category of [
      "transfer",
      "card_payment",
      "investment",
      "income",
      "fixed",
    ] as const)
      expect(
        metrics([
          transaction({ name: "Coffee shop", normalized_category: category }),
        ]).posted,
      ).toBe(0);
  });
  it("gives explicit category and inclusion overrides precedence", () => {
    expect(
      metrics([
        transaction({
          normalized_category: "transfer",
          category_override: "dining",
        }),
      ]).posted,
    ).toBe(10);
    expect(
      metrics([transaction({ weekly_budget_override: "exclude" })]).excluded,
    ).toBe(10);
    expect(
      metrics([
        transaction({
          normalized_category: "needs_review",
          weekly_budget_override: "include",
        }),
      ]).posted,
    ).toBe(10);
  });
  it("reports unknown categories and source decisions rather than including them", () => {
    expect(
      metrics([transaction({ normalized_category: "needs_review" })]),
    ).toMatchObject({ posted: 0, reviewCount: 1, review: 10 });
    expect(
      metrics([transaction()], 100, [
        { ...account, weekly_budget_source: "review" },
      ]).reviewCount,
    ).toBe(1);
  });
});
describe("budget math and deduplication", () => {
  it("keeps unmatched credits separate and never creates artificial extra budget", () => {
    expect(metrics([transaction({ amount: -50 })])).toMatchObject({
      posted: 0,
      unmatchedCredits: 50,
      remaining: 100,
    });
  });
  it("allows explicit discretionary credits with a zero net floor", () => {
    expect(
      metrics([
        transaction(),
        transaction({
          id: "refund",
          plaid_transaction_id: "refund",
          amount: -50,
          category_override: "dining",
        }),
      ]),
    ).toMatchObject({ posted: 0, remaining: 100 });
  });
  it("separates pending and suppresses a linked pending predecessor", () => {
    expect(metrics([transaction({ pending: true })])).toMatchObject({
      posted: 0,
      pending: 10,
    });
    expect(
      metrics([
        transaction({ pending: true }),
        transaction({
          id: "posted",
          plaid_transaction_id: "posted",
          pending_transaction_id: "p",
        }),
      ]),
    ).toMatchObject({ posted: 10, pending: 0 });
  });
  it("uses durable account identity to exclude repeated connections without deleting rows", () => {
    const accounts = [
      { ...account, persistent_account_id: "durable" },
      {
        ...account,
        id: "b",
        persistent_account_id: "durable",
        created_at: "2026-02-01",
      },
    ];
    expect(accountSources(accounts).get("b")).toBe("duplicate");
    const rows = [
      transaction(),
      transaction({ id: "t2", plaid_transaction_id: "p2", account_id: "b" }),
    ];
    expect(metrics(rows, 100, accounts)).toMatchObject({
      posted: 10,
      excluded: 10,
    });
    expect(rows).toHaveLength(2);
  });
  it("does not fuzzy-dedupe legitimate identical purchases", () =>
    expect(
      metrics([
        transaction(),
        transaction({ id: "t2", plaid_transaction_id: "p2" }),
      ]).posted,
    ).toBe(20));
  it("deduplicates provider identity and supports explicit account exclusion", () => {
    expect(metrics([transaction(), transaction({ id: "t2" })]).posted).toBe(10);
    expect(
      transactionDecision(transaction(), [
        { ...account, weekly_budget_source: "exclude" },
      ]).kind,
    ).toBe("exclude");
  });
  it("keeps non-USD and unknown currencies outside USD totals", () => {
    expect(
      metrics([transaction({ transaction_currency: "CAD" })]),
    ).toMatchObject({ posted: 0, currencyCount: 1 });
    expect(
      metrics([transaction({ transaction_currency: null })], 100, [
        { ...account, currency: null },
      ]).currencyCount,
    ).toBe(1);
  });
  it("supports no limit, zero limit, over-budget, and previous week", () => {
    expect(metrics([], null)).toMatchObject({
      limit: null,
      remaining: null,
      posted: 0,
    });
    expect(metrics([transaction()], 0)).toMatchObject({
      remaining: -10,
      overBudget: 10,
      percentage: 100,
    });
    expect(
      metrics([
        transaction({ amount: 120 }),
        transaction({
          id: "previous",
          plaid_transaction_id: "prev",
          date: "2026-11-04",
          amount: 30,
        }),
      ]),
    ).toMatchObject({
      posted: 120,
      previous: 30,
      change: 90,
      remaining: -20,
      overBudget: 20,
      suggestedDaily: 0,
    });
  });
  it("uses integer cents and reviews partial invalid data", () => {
    expect(
      metrics([
        transaction({ amount: 0.1 }),
        transaction({ id: "two", plaid_transaction_id: "two", amount: 0.2 }),
      ]).posted,
    ).toBe(0.3);
    expect(metrics([transaction({ amount: "bad" })]).reviewCount).toBe(1);
    expect(metrics([transaction({ amount: null })]).reviewCount).toBe(1);
    expect(metrics([transaction({ amount: "" })]).reviewCount).toBe(1);
    expect(metrics([transaction({ pending: null })])).toMatchObject({
      posted: 0,
      reviewCount: 1,
    });
    expect(metrics([transaction({ account_id: null })]).reviewCount).toBe(1);
  });
});
