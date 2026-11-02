import { describe, expect, it } from "vitest";
import { LEGACY_EXAMPLE_FINANCIAL_PROFILE, STARTER_FINANCIAL_PROFILE, type FinancialProfile } from "./financialProfileDefaults";
import { normalizeFinancialProfile, validateFinancialProfileCollections } from "./financialProfileNormalization";

describe("normalizeFinancialProfile", () => {
  it("preserves legacy income and paycheck configuration without fabricating a configured collection", () => {
    const legacy: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      income: { amount: 2400, basis: "take-home", frequency: "biweekly" },
      paychecks: { netAmount: 2400, frequency: "biweekly", paydays: ["2027-01-01"], rothContribution: 150 },
      retirementContributions: { destination: "Example Roth account", perPaycheck: 150 },
    };
    const normalized = normalizeFinancialProfile(legacy);
    expect(normalized.incomeSources).toBeUndefined();
    expect(normalized.retirementContributionPlans?.[0]).toMatchObject({
      destinationAccountName: "Example Roth account",
      contribution: { basis: "amount", amount: 150, frequency: "biweekly" },
    });
    expect(normalized.income).toEqual(legacy.income);
    expect(normalized.paychecks).toEqual(legacy.paychecks);
    expect(normalized.retirementContributions).toEqual(legacy.retirementContributions);
  });

  it("keeps a known legacy paycheck separate when the saved income section is incomplete", () => {
    const profile: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      income: {},
      paychecks: { netAmount: 0, frequency: "semimonthly" },
    };
    expect(normalizeFinancialProfile(profile).incomeSources).toBeUndefined();
  });

  it("preserves multiple independent income sources", () => {
    const profile: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      income: { amount: 1000, basis: "gross", frequency: "monthly" },
      incomeSources: [
        { name: "Job A", type: "employment", amount: 3000, basis: "gross", frequency: "monthly", regularity: "regular" },
        { name: "Weekend work", type: "self-employment", amount: 250, basis: "net", frequency: "irregular", regularity: "irregular" },
      ],
    };
    expect(normalizeFinancialProfile(profile).incomeSources).toEqual(profile.incomeSources);
  });

  it("preserves multiple bank, retirement, and brokerage accounts with balance sources", () => {
    const profile: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      financialAccounts: [
        { name: "Checking", accountType: "depository", subtype: "checking", currency: "USD", balance: 0, balanceSource: "manual" },
        { name: "401(k)", accountType: "retirement", subtype: "traditional 401k", balanceSource: "imported" },
        { name: "Brokerage", accountType: "investment", subtype: "taxable", balance: 5000, balanceSource: "imported" },
      ],
    };
    expect(normalizeFinancialProfile(profile).financialAccounts).toEqual(profile.financialAccounts);
    expect(profile.financialAccounts?.[0].balance).toBe(0);
    expect(profile.financialAccounts?.[1].balance).toBeUndefined();
  });

  it("keeps multiple retirement contribution destinations independent", () => {
    const plans = [
      { name: "Work plan", destinationAccountName: "401(k)", contribution: { basis: "percentage" as const, percentage: 8, percentageOf: "gross-income" as const, frequency: "biweekly" as const }, employerMatch: { percentage: 50, basis: "employee-contribution" as const, maximumPercentageOfSalary: 4 } },
      { name: "Personal IRA", destinationAccountName: "Traditional IRA", contribution: { basis: "amount" as const, amount: 200, frequency: "monthly" as const } },
    ];
    expect(normalizeFinancialProfile({ ...STARTER_FINANCIAL_PROFILE, retirementContributionPlans: plans }).retirementContributionPlans).toEqual(plans);
  });

  it("preserves multiple debts and recurring expenses without collapsing payment semantics", () => {
    const profile: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      debts: [
        { name: "Auto loan", type: "auto-loan", balance: 12000, annualInterestRatePercent: 5.2, minimumPayment: 300, paymentFrequency: "monthly" },
        { name: "Card", type: "credit-card", balance: 0, monthlyPayment: 0 },
      ],
      recurringExpenses: [
        { name: "Rent", category: "housing", amount: 1400, frequency: "monthly", dueDate: "2027-01-01" },
        { name: "Insurance", category: "transportation", amount: 500, frequency: "annual" },
      ],
    };
    expect(normalizeFinancialProfile(profile)).toMatchObject({ debts: profile.debts, recurringExpenses: profile.recurringExpenses });
  });

  it("validates property values, ownership, and currency without changing mortgage debts", () => {
    const profile: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      properties: [{ id: "home", name: "Home", propertyType: "primary-residence", estimatedMarketValue: 300000, ownershipPercentage: 50, currency: "USD" }],
      debts: [{ name: "Mortgage", type: "mortgage", balance: 150000, minimumPayment: 1200 }],
    };
    expect(normalizeFinancialProfile(profile).properties).toEqual(profile.properties);
    expect(validateFinancialProfileCollections({
      ...profile,
      properties: [{ ...profile.properties![0], estimatedMarketValue: -1, ownershipPercentage: 101, currency: "US" }],
    })).toMatchObject({
      "properties.0.estimatedMarketValue": expect.any(String),
      "properties.0.ownershipPercentage": expect.any(String),
      "properties.0.currency": expect.any(String),
    });
    expect(profile.debts?.[0]).not.toHaveProperty("linkedDebtId");
  });

  it("preserves absent values as unknown and explicit zero as entered", () => {
    const profile: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      income: { frequency: "monthly" },
      manualBalances: { cash: 0, source: "user-entered" },
      financialAccounts: [{ name: "Unknown savings", accountType: "depository", subtype: "savings", balanceSource: "unknown" }],
    };
    const normalized = normalizeFinancialProfile(profile);
    expect(normalized.incomeSources).toBeUndefined();
    expect(normalized.financialAccounts?.[0].balance).toBeUndefined();
    expect(normalized.financialAccounts).toHaveLength(1);
    expect(normalized.manualBalances?.cash).toBe(0);
    expect(validateFinancialProfileCollections(normalized)).toEqual({});
  });

  it("converts legacy manual balances without losing their source field", () => {
    const normalized = normalizeFinancialProfile({
      ...STARTER_FINANCIAL_PROFILE,
      manualBalances: { cash: 0, source: "user-entered" },
    });
    expect(normalized.financialAccounts).toEqual([{
      name: "Cash estimate", accountType: "cash", balance: 0, balanceSource: "manual", currency: "USD",
    }]);
    expect(normalized.manualBalances?.cash).toBe(0);
  });

  it("supports biweekly and semimonthly income and irregular expenses without converting their entered values", () => {
    const profile: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      incomeSources: [
        { name: "Biweekly job", type: "employment", amount: 1800, basis: "net", frequency: "biweekly" },
        { name: "Twice monthly contract", type: "self-employment", amount: 700, basis: "gross", frequency: "semimonthly" },
      ],
      recurringExpenses: [{ name: "Seasonal fee", amount: 120, frequency: "irregular" }],
    };
    expect(normalizeFinancialProfile(profile)).toEqual(profile);
    expect(validateFinancialProfileCollections(profile)).toEqual({});
  });

  it("does not duplicate legacy settings when the corresponding collections are populated", () => {
    const profile: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      income: { amount: 2000, basis: "gross", frequency: "monthly" },
      incomeSources: [{ name: "New source", type: "employment", amount: 3000, basis: "gross", frequency: "monthly" }],
      manualBalances: { cash: 100, savings: 200, source: "user-entered" },
      financialAccounts: [
        { name: "Checking", accountType: "depository", subtype: "checking", balanceSource: "imported" },
        { name: "Savings", accountType: "depository", subtype: "savings", balanceSource: "manual" },
      ],
      retirementContributions: { perPaycheck: 100 },
      retirementContributionPlans: [{ name: "Retirement plan", contribution: { basis: "amount", amount: 300, frequency: "monthly" } }],
    };
    const normalized = normalizeFinancialProfile(profile);
    expect(normalized.incomeSources).toHaveLength(1);
    expect(normalized.financialAccounts).toHaveLength(2);
    expect(normalized.retirementContributionPlans).toHaveLength(1);
  });

  it("treats explicitly empty collections as intentional and does not repopulate removed legacy entries", () => {
    const normalized = normalizeFinancialProfile({
      ...STARTER_FINANCIAL_PROFILE,
      income: { amount: 2500, basis: "take-home", frequency: "monthly" },
      manualBalances: { cash: 100, source: "user-entered" },
      retirementContributions: { perPaycheck: 100 },
      incomeSources: [], financialAccounts: [], retirementContributionPlans: [],
    });
    expect(normalized.incomeSources).toEqual([]);
    expect(normalized.financialAccounts).toEqual([]);
    expect(normalized.retirementContributionPlans).toEqual([]);
    expect(normalized.income?.amount).toBe(2500);
    expect(normalized.manualBalances?.cash).toBe(100);
    expect(normalized.retirementContributions?.perPaycheck).toBe(100);
  });

  it("is deterministic and idempotent without mutating the input", () => {
    const profile: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      income: { amount: 0, basis: "take-home", frequency: "monthly" },
      manualBalances: { cash: 0, source: "user-entered" },
      retirementContributions: { percentageOfIncome: 0 },
    };
    const before = structuredClone(profile);
    const once = normalizeFinancialProfile(profile);
    const twice = normalizeFinancialProfile(once);
    expect(profile).toEqual(before);
    expect(twice).toEqual(once);
    expect(once.incomeSources).toBeUndefined();
    expect(once.financialAccounts?.[0].balance).toBe(0);
    expect(once.retirementContributionPlans?.[0].contribution.percentage).toBe(0);
  });

  it("keeps the starter profile generic and preserves the legacy example exactly", () => {
    const legacyBefore = structuredClone(LEGACY_EXAMPLE_FINANCIAL_PROFILE);
    expect(STARTER_FINANCIAL_PROFILE).toEqual({ label: "Starter template (customize with your own values)", currency: "USD" });
    const normalized = normalizeFinancialProfile(LEGACY_EXAMPLE_FINANCIAL_PROFILE);
    expect(LEGACY_EXAMPLE_FINANCIAL_PROFILE).toEqual(legacyBefore);
    expect(normalized.paychecks).toEqual(legacyBefore.paychecks);
    expect(normalized.roth).toEqual(legacyBefore.roth);
    expect(normalized.bills).toEqual(legacyBefore.bills);
    expect(normalized.weeklySpending).toEqual(legacyBefore.weeklySpending);
    expect(normalized.budget).toEqual(legacyBefore.budget);
    expect(normalizeFinancialProfile(normalized)).toEqual(normalized);
  });

  it("validates nonnegative configuration amounts while allowing unknown and explicit zero", () => {
    const valid: FinancialProfile = {
      ...STARTER_FINANCIAL_PROFILE,
      incomeSources: [{ name: "Job", type: "employment", amount: 0, basis: "net", frequency: "monthly" }],
      financialAccounts: [{ name: "Overdraft", accountType: "depository", balance: -10, balanceSource: "manual" }],
      debts: [{ name: "Loan", balance: 0, minimumPayment: 0, annualInterestRatePercent: 0 }],
      goals: [{ name: "Reserve", targetAmount: 0 }],
    };
    expect(validateFinancialProfileCollections(valid)).toEqual({});
    const invalid: FinancialProfile = {
      ...valid,
      financialAccounts: [{ name: "Brokerage", accountType: "investment", balance: -10, balanceSource: "manual" }],
      recurringExpenses: [{ name: "Bad row", amount: -1, frequency: "monthly" }],
      retirementContributionPlans: [{ name: "Invalid contribution", contribution: { basis: "percentage", percentage: 101, percentageOf: "unknown" } }],
    };
    expect(validateFinancialProfileCollections(invalid)).toMatchObject({
      "recurringExpenses.0.amount": expect.any(String),
      "financialAccounts.0.balance": expect.any(String),
      "retirementContributionPlans.0.percentage": expect.any(String),
    });
  });

  it("validates recurring expense frequencies server-side while allowing an unknown amount", () => {
    const profile = {
      ...STARTER_FINANCIAL_PROFILE,
      recurringExpenses: [{ name: "Fictional charge", amount: undefined, frequency: "monthly" as const }, { name: "Fictional unsupported", amount: 0, frequency: "other" as never }],
    };
    expect(validateFinancialProfileCollections(profile)["recurringExpenses.1.frequency"]).toBeDefined();
    expect(validateFinancialProfileCollections({ ...profile, recurringExpenses: [profile.recurringExpenses[0]] })).toEqual({});
  });
});
