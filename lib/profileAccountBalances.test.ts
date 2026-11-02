import { describe, expect, it } from "vitest";
import { LEGACY_EXAMPLE_FINANCIAL_PROFILE, STARTER_FINANCIAL_PROFILE, type FinancialAccountProfile, type FinancialProfile } from "./financialProfileDefaults";
import { normalizeFinancialProfile } from "./financialProfileNormalization";
import { summarizeProfileAccountBalances } from "./profileAccountBalances";

const account = (overrides: Partial<FinancialAccountProfile> = {}): FinancialAccountProfile => ({
  name: "Fictional account", accountType: "depository", subtype: "checking", balance: 100, balanceSource: "manual", ...overrides,
});
const profile = (financialAccounts: readonly FinancialAccountProfile[], extras: Partial<FinancialProfile> = {}) => normalizeFinancialProfile({ ...STARTER_FINANCIAL_PROFILE, ...extras, financialAccounts });

describe("summarizeProfileAccountBalances", () => {
  it("sums multiple checking and savings accounts", () => {
    expect(summarizeProfileAccountBalances(profile([
      account({ name: "Fictional checking", subtype: "checking", balance: 300 }),
      account({ name: "Fictional savings", subtype: "savings", balance: 700 }),
      account({ name: "Fictional cash", accountType: "cash", balance: 50 }),
    ])).cash).toBe(1050);
  });

  it("sums brokerage and retirement balances as assets", () => {
    const result = summarizeProfileAccountBalances(profile([
      account({ name: "Fictional brokerage", accountType: "investment", balance: 2000 }),
      account({ name: "Fictional retirement", accountType: "retirement", balance: 8000 }),
    ]));
    expect(result.investments).toBe(10000);
    expect(result.netWorth).toBe(10000);
  });

  it("subtracts multiple credit and loan balances as liabilities", () => {
    const result = summarizeProfileAccountBalances(profile([
      account({ name: "Fictional card", accountType: "credit", balance: 300 }),
      account({ name: "Fictional loan", accountType: "loan", balance: 1700 }),
      account({ name: "Fictional checking", balance: 3000 }),
    ]));
    expect(result.liabilities).toBe(2000);
    expect(result.netWorth).toBe(1000);
  });

  it("treats a negative credit-card balance as a credit against amounts owed", () => {
    const result = summarizeProfileAccountBalances(profile([
      account({ name: "Fictional card debt", accountType: "credit", balance: 300 }),
      account({ name: "Fictional card credit", accountType: "credit", balance: -100 }),
      account({ name: "Fictional checking", balance: 1000 }),
    ]));
    expect(result.liabilities).toBe(200);
    expect(result.netWorth).toBe(800);
  });

  it("keeps known and unknown liabilities incomplete", () => {
    const result = summarizeProfileAccountBalances(profile([
      account({ name: "Known loan", accountType: "loan", balance: 500 }),
      account({ name: "Unknown card", accountType: "credit", balance: undefined }),
    ]));
    expect(result.liabilities).toBeNull();
    expect(result.netWorth).toBeNull();
    expect(result.complete).toBe(false);
  });

  it("preserves explicit zero and reports unknown balances as incomplete", () => {
    const result = summarizeProfileAccountBalances(profile([
      account({ name: "Zero balance", balance: 0 }),
      account({ name: "Unknown balance", balance: undefined, subtype: "savings" }),
    ]));
    expect(result.items[0]).toMatchObject({ balance: 0, included: true });
    expect(result.items[1]).toMatchObject({ included: false, exclusionReason: "unknown-balance" });
    expect(result.cash).toBeNull();
    expect(result.netWorth).toBeNull();
    expect(result.complete).toBe(false);
  });

  it("accepts negative overdraft and credit balances but rejects invalid negative asset or loan balances", () => {
    const result = summarizeProfileAccountBalances(profile([
      account({ name: "Fictional overdraft", balance: -50 }),
      account({ name: "Fictional card credit", accountType: "credit", balance: -20 }),
      account({ name: "Invalid investment", accountType: "investment", balance: -10 }),
      account({ name: "Invalid loan", accountType: "loan", balance: -5 }),
    ]));
    expect(result.items.slice(0, 2).every((item) => item.included)).toBe(true);
    expect(result.items.slice(2).map((item) => item.exclusionReason)).toEqual(["invalid-balance", "invalid-balance"]);
    expect(result.complete).toBe(false);
  });

  it("treats an empty collection as no account information", () => {
    expect(summarizeProfileAccountBalances(profile([]))).toMatchObject({ configured: false, netWorth: null, complete: false });
    expect(summarizeProfileAccountBalances({ ...STARTER_FINANCIAL_PROFILE, manualBalances: { cash: 100, source: "user-entered" } })).toMatchObject({ configured: false, netWorth: null });
  });

  it("keeps unsupported account types out of totals and flags incompleteness", () => {
    const result = summarizeProfileAccountBalances(profile([account({ name: "Unclassified balance", accountType: "other", balance: 900 })]));
    expect(result.netWorth).toBeNull();
    expect(result.excludedCount).toBe(1);
    expect(result.items[0].exclusionReason).toBe("unsupported-account-type");
  });

  it("preserves Richard's example values and excludes its unconfigured profile accounts", () => {
    const before = structuredClone(LEGACY_EXAMPLE_FINANCIAL_PROFILE);
    expect(LEGACY_EXAMPLE_FINANCIAL_PROFILE).toEqual(before);
    expect(LEGACY_EXAMPLE_FINANCIAL_PROFILE.financialAccounts).toBeUndefined();
    expect(summarizeProfileAccountBalances(LEGACY_EXAMPLE_FINANCIAL_PROFILE).configured).toBe(false);
  });
});
