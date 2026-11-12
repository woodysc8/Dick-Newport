import { describe, expect, it } from "vitest";
import { classifyTransaction } from "./transactionClassification";
import {
  budgetDecision,
  emptyPolicy,
  financialBudget,
  monthPeriod,
  type BudgetPolicy,
} from "./budgetEngine";
import type { BudgetAccount, BudgetTransaction } from "./discretionaryBudget";
export const testAccount: BudgetAccount = {
  id: "a",
  account_name: "Checking",
  institution_name: "Fixture",
  currency: "USD",
  persistent_account_id: null,
  weekly_budget_source: "include",
  created_at: "2026-01-01",
};
export const testTransaction = (
  changes: Partial<BudgetTransaction> = {},
): BudgetTransaction => ({
  id: "t",
  account_id: "a",
  plaid_transaction_id: "p",
  date: "2026-11-11",
  name: "Fixture",
  merchant_name: null,
  amount: 10,
  pending: false,
  category: null,
  normalized_category: "needs_review",
  category_override: null,
  weekly_budget_override: null,
  monthly_budget_override: null,
  transaction_currency: "USD",
  pending_transaction_id: null,
  plaid_primary_category: null,
  plaid_detailed_category: null,
  plaid_category_confidence: null,
  ...changes,
});
const now = new Date("2026-11-11T17:00:00Z");
const compute = (
  rows: BudgetTransaction[],
  policy = emptyPolicy,
  accounts = [testAccount],
  limit: number | null = 420,
) => financialBudget(rows, accounts, limit, policy, now);
describe("explainable classification", () => {
  it.each([
    [{ merchant_name: "Bagel Express on Broadway" }, "dining", "merchant_rule"],
    [{ merchant_name: "Walgreens" }, "needs_review", "needs_review"],
    [{ name: "Payment" }, "needs_review", "needs_review"],
    [
      {
        name: "Payment",
        plaid_primary_category: "TRANSFER_OUT",
        plaid_category_confidence: "HIGH",
      },
      "transfer",
      "provider_primary",
    ],
    [
      {
        merchant_name: "Walgreens",
        plaid_detailed_category:
          "GENERAL_MERCHANDISE_DRUGSTORES_AND_PHARMACIES",
        plaid_primary_category: "GENERAL_MERCHANDISE",
        plaid_category_confidence: "HIGH",
      },
      "needs_review",
      "provider_detailed",
    ],
    [
      {
        merchant_name: "Walgreens",
        plaid_detailed_category: "MEDICAL_PHARMACIES_AND_SUPPLEMENTS",
        plaid_primary_category: "MEDICAL",
        plaid_category_confidence: "HIGH",
      },
      "healthcare",
      "provider_detailed",
    ],
    [
      {
        merchant_name: "Bagel Express",
        plaid_primary_category: "TRANSFER_OUT",
        plaid_category_confidence: "LOW",
      },
      "needs_review",
      "needs_review",
    ],
    [
      {
        category_override: "groceries",
        plaid_primary_category: "TRANSFER_OUT",
      },
      "groceries",
      "user_override",
    ],
  ] as const)("classifies %j conservatively", (input, category, source) =>
    expect(classifyTransaction(testTransaction(input))).toMatchObject({
      category,
      source,
    }),
  );
  it("is repeatable, non-destructive and never overwrites raw data or manual preferences", () => {
    const t = testTransaction({
        merchant_name: "Bagel Express",
        category_override: "coffee",
        weekly_budget_override: "exclude",
      }),
      before = structuredClone(t);
    expect(classifyTransaction(t)).toEqual(classifyTransaction(t));
    compute([t]);
    expect(t).toEqual(before);
  });
});
describe("shared weekly/monthly budget", () => {
  it("preserves the $420 limit and marks $527.26 unreviewed spending provisional", () => {
    const rows = Array.from({ length: 17 }, (_, i) =>
      testTransaction({
        id: String(i),
        plaid_transaction_id: String(i),
        amount: i === 0 ? 47.26 : 30,
      }),
    );
    expect(compute(rows).weekly).toMatchObject({
      limit: 420,
      posted: 0,
      reviewCount: 17,
      review: 527.26,
      remaining: 420,
      provisional: true,
      safeRemaining: null,
      conservativeRemaining: -107.26,
      suggestedDaily: null,
    });
  });
  it("includes groceries weekly and rent only in monthly fixed obligations", () => {
    const result = compute([
      testTransaction({ category_override: "groceries", amount: 50 }),
      testTransaction({
        id: "rent",
        plaid_transaction_id: "rent",
        category_override: "housing",
        amount: 1000,
      }),
    ]);
    expect(result.weekly).toMatchObject({
      posted: 50,
      excluded: 1000,
      remaining: 370,
    });
    expect(result.monthly).toMatchObject({
      posted: 1050,
      groups: { fixed: 1000, discretionary: 50 },
    });
  });
  it("applies transaction > account > category rules, behind source/currency protection", () => {
    const policy: BudgetPolicy = {
      ...emptyPolicy,
      accounts: [
        { account_id: "a", weekly_included: false, monthly_included: true },
      ],
      categories: [
        {
          category: "groceries",
          weekly_included: true,
          monthly_included: false,
          monthly_group: null,
          weekly_cap: 40,
          monthly_cap: 100,
        },
      ],
    };
    const t = testTransaction({ category_override: "groceries" });
    expect(budgetDecision(t, [testAccount], policy, "weekly").kind).toBe(
      "exclude",
    );
    expect(budgetDecision(t, [testAccount], policy, "monthly").kind).toBe(
      "include",
    );
    expect(
      compute(
        [
          {
            ...t,
            weekly_budget_override: "include",
            monthly_budget_override: "exclude",
          },
        ],
        policy,
      ),
    ).toMatchObject({
      weekly: { posted: 10 },
      monthly: { posted: 0 },
      caps: [{ weekly_limit: 40, monthly_limit: 100 }],
    });
    expect(
      budgetDecision(
        { ...t, weekly_budget_override: "include" },
        [{ ...testAccount, weekly_budget_source: "exclude" }],
        policy,
        "weekly",
      ).kind,
    ).toBe("exclude");
  });
  it("does not let account-wide inclusion automatically count payments or unknowns", () => {
    const policy = {
      ...emptyPolicy,
      accounts: [
        { account_id: "a", weekly_included: true, monthly_included: true },
      ],
    };
    const result = compute(
      [
        testTransaction(),
        testTransaction({
          id: "card",
          plaid_transaction_id: "card",
          category_override: "card_payment",
          amount: 100,
        }),
      ],
      policy,
    );
    expect(result.weekly).toMatchObject({
      posted: 0,
      reviewCount: 1,
      excluded: 100,
    });
    expect(result.monthly).toMatchObject({
      posted: 0,
      reviewCount: 1,
      excluded: 100,
    });
  });
  it.each([
    "transfer",
    "card_payment",
    "investment",
    "savings",
    "income",
    "debt_payment",
  ] as const)("excludes %s from spending but retains cash flow", (category) => {
    const result = compute([
      testTransaction({ category_override: category, amount: 100 }),
    ]);
    expect(result.weekly.posted).toBe(0);
    expect(result.monthly.posted).toBe(0);
    expect(result.monthly.cashflow.outflow).toBe(100);
  });
  it("keeps unmatched credits separate, permits explicitly classified refunds and floors net at zero", () => {
    const unmatched = testTransaction({
      amount: -500,
      plaid_primary_category: "FOOD_AND_DRINK",
      plaid_category_confidence: "HIGH",
    });
    expect(compute([unmatched])).toMatchObject({
      weekly: { posted: 0, remaining: 420, unmatchedCredits: 500 },
      monthly: { posted: 0 },
    });
    expect(
      compute([{ ...unmatched, category_override: "dining" }]).weekly,
    ).toMatchObject({ posted: 0, remaining: 420 });
  });
  it("suppresses linked pending and durable duplicates without fuzzy deletion", () => {
    const rows = [
      testTransaction({ pending: true, category_override: "dining" }),
      testTransaction({
        id: "posted",
        plaid_transaction_id: "posted",
        pending_transaction_id: "p",
        category_override: "dining",
      }),
      testTransaction({
        id: "dup",
        plaid_transaction_id: "dup",
        account_id: "b",
        category_override: "dining",
      }),
    ];
    const accounts = [
      { ...testAccount, persistent_account_id: "durable" },
      {
        ...testAccount,
        id: "b",
        persistent_account_id: "durable",
        created_at: "2026-02-01",
      },
    ];
    expect(compute(rows, emptyPolicy, accounts)).toMatchObject({
      weekly: { posted: 10, pending: 0 },
      monthly: { posted: 10, pending: 0 },
    });
    expect(rows.length).toBe(3);
    expect(
      compute([
        rows[1],
        { ...rows[1], id: "other", plaid_transaction_id: "other" },
      ]).weekly.posted,
    ).toBe(20);
  });
  it("handles empty, partial, missing-limit, zero and over-budget states", () => {
    expect(
      compute([], emptyPolicy, [testAccount], null).weekly.remaining,
    ).toBeNull();
    expect(
      compute([testTransaction({ amount: null })]).weekly.reviewCount,
    ).toBe(1);
    expect(
      compute(
        [testTransaction({ category_override: "dining" })],
        emptyPolicy,
        [testAccount],
        0,
      ).weekly,
    ).toMatchObject({ remaining: -10, overBudget: 10 });
  });
  it("does not mix unknown or non-USD currency into either period", () => {
    for (const currency of [null, "EUR"])
      expect(
        compute(
          [
            testTransaction({
              transaction_currency: currency,
              category_override: "dining",
            }),
          ],
          emptyPolicy,
          [{ ...testAccount, currency }],
        ),
      ).toMatchObject({
        weekly: { posted: 0, currencyCount: 1, safeRemaining: null },
        monthly: { posted: 0, currencyCount: 1 },
      });
  });
  it.each([
    ["2026-03-01T04:59:59Z", "2026-02-01"],
    ["2026-03-01T05:00:00Z", "2026-03-01"],
    ["2026-11-01T03:59:59Z", "2026-10-01"],
    ["2026-11-01T04:00:00Z", "2026-11-01"],
  ])("resolves NY month boundary %s", (instant, start) =>
    expect(monthPeriod(new Date(instant)).start).toBe(start),
  );
});
