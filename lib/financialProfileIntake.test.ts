import { describe, expect, it, vi } from "vitest";
import { STARTER_FINANCIAL_PROFILE } from "./financialProfileDefaults";
import { parseFinancialProfileIntake, persistFinancialProfile, serializeFinancialProfile } from "./financialProfileIntake";

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

describe("financial profile intake", () => {
  it("keeps a new user's blank answers unknown rather than zero", () => {
    const result = parseFinancialProfileIntake(form({}), STARTER_FINANCIAL_PROFILE);
    expect(result.errors).toEqual({});
    expect(result.profile?.income).toBeUndefined();
    expect(result.profile?.manualBalances).toBeUndefined();
    expect(result.profile?.budget?.monthlyIncome).toBeUndefined();
    expect(result.profile?.budget?.expenses).toBeUndefined();
  });

  it("validates income basis, ranges, categories, debt, and goal dates", () => {
    const result = parseFinancialProfileIntake(form({
      incomeAmount: "1000", incomeFrequency: "biweekly", incomeBasis: "",
      retirementPercent: "101", monthlyExpenses: "not json", debts: "[]",
      goals: JSON.stringify([{ name: "Home", targetAmount: 1000, targetDate: "2026-15-99" }]),
    }), STARTER_FINANCIAL_PROFILE);
    expect(result.profile).toBeUndefined();
    expect(result.errors.incomeBasis).toMatch(/gross or take-home/);
    expect(result.errors.retirementPercent).toMatch(/0 to 100/);
    expect(result.errors.monthlyExpenses).toBeDefined();
    expect(result.errors.goals).toBeDefined();
  });

  it("serializes entered data and converts take-home pay to a monthly plan without treating gross as spendable", () => {
    const data = form({
      fullName: "Taylor Example", incomeAmount: "2000", incomeBasis: "take-home", incomeFrequency: "biweekly",
      monthlySpendingTarget: "2500", monthlyExpenses: JSON.stringify([{ name: "Housing", category: "housing", amount: 1200 }]),
      cashBalance: "", savingsBalance: "700", debts: JSON.stringify([{ name: "Loan", balance: 5000, monthlyPayment: 200 }]),
      goals: JSON.stringify([{ name: "Trip", targetAmount: 1500, targetDate: "2027-04-01" }]),
    });
    const result = parseFinancialProfileIntake(data, STARTER_FINANCIAL_PROFILE);
    expect(result.errors).toEqual({});
    expect(result.profile?.income).toEqual({ amount: 2000, basis: "take-home", frequency: "biweekly" });
    expect(result.profile?.budget?.monthlyIncome).toBeCloseTo(2000 * 26 / 12);
    expect(result.profile?.manualBalances).toEqual({ savings: 700, source: "user-entered" });
    expect(JSON.parse(serializeFinancialProfile(result.profile!)).debts[0].balance).toBe(5000);
    expect(result.profile?.debts?.[0].monthlyPayment).toBe(200);

    const gross = parseFinancialProfileIntake(form({ incomeAmount: "5000", incomeBasis: "gross", incomeFrequency: "monthly" }), STARTER_FINANCIAL_PROFILE);
    expect(gross.profile?.budget?.monthlyIncome).toBeUndefined();
  });

  it("uses the selected frequency for monthly take-home conversion and leaves variable frequency unknown", () => {
    const weekly = parseFinancialProfileIntake(form({ incomeAmount: "500", incomeBasis: "take-home", incomeFrequency: "weekly" }), STARTER_FINANCIAL_PROFILE);
    const semimonthly = parseFinancialProfileIntake(form({ incomeAmount: "1000", incomeBasis: "take-home", incomeFrequency: "semimonthly" }), STARTER_FINANCIAL_PROFILE);
    const variable = parseFinancialProfileIntake(form({ incomeAmount: "1000", incomeBasis: "take-home", incomeFrequency: "other" }), STARTER_FINANCIAL_PROFILE);
    expect(weekly.profile?.budget?.monthlyIncome).toBeCloseTo(500 * 52 / 12);
    expect(semimonthly.profile?.budget?.monthlyIncome).toBe(2000);
    expect(variable.profile?.budget?.monthlyIncome).toBeUndefined();
  });

  it("preserves extended debt fields and existing rows when legacy form fields are omitted", () => {
    const current = {
      ...STARTER_FINANCIAL_PROFILE,
      debts: [{ name: "Auto loan", type: "auto-loan" as const, balance: 0, annualInterestRatePercent: 4.2, minimumPayment: 250, paymentFrequency: "monthly" as const }],
      goals: [{ name: "Reserve", targetAmount: 0 }],
    };
    const omitted = parseFinancialProfileIntake(form({}), current);
    expect(omitted.profile?.debts).toEqual(current.debts);
    expect(omitted.profile?.goals).toEqual(current.goals);

    const edited = parseFinancialProfileIntake(form({
      debts: JSON.stringify(current.debts),
      goals: JSON.stringify(current.goals),
    }), current);
    expect(edited.profile?.debts).toEqual(current.debts);
    expect(edited.profile?.debts?.[0]).toMatchObject({ type: "auto-loan", annualInterestRatePercent: 4.2, minimumPayment: 250, paymentFrequency: "monthly" });
  });

  it("preserves every collection when a partial form omits its fields", () => {
    const current = {
      ...STARTER_FINANCIAL_PROFILE,
      incomeSources: [{ name: "Job", type: "employment" as const, amount: 0, basis: "net" as const, frequency: "monthly" as const }],
      financialAccounts: [{ name: "Checking", accountType: "depository" as const, balance: 0, balanceSource: "manual" as const }],
      retirementContributionPlans: [{ name: "IRA", contribution: { basis: "amount" as const, amount: 0 } }],
      debts: [{ name: "Card", balance: 0 }],
      recurringExpenses: [{ name: "Rent", amount: 0, frequency: "monthly" as const }],
      savingsAllocations: [{ name: "Reserve", amount: 0, frequency: "monthly" as const }],
      goals: [{ name: "Goal", targetAmount: 0 }],
    };
    const result = parseFinancialProfileIntake(form({}), current);
    expect(result.errors).toEqual({});
    expect(result.profile).toMatchObject({
      incomeSources: current.incomeSources,
      financialAccounts: current.financialAccounts,
      retirementContributionPlans: current.retirementContributionPlans,
      debts: current.debts,
      recurringExpenses: current.recurringExpenses,
      savingsAllocations: current.savingsAllocations,
      goals: current.goals,
    });
  });

  it("saves and reloads all profile collections while preserving unrelated legacy settings", () => {
    const current = {
      ...STARTER_FINANCIAL_PROFILE,
      income: { amount: 4000, basis: "gross" as const, frequency: "monthly" as const },
      paychecks: { netAmount: 2400, frequency: "monthly" as const, rothContribution: 100 },
      retirementContributions: { perPaycheck: 100, destination: "Legacy workplace plan" },
      manualBalances: { cash: 75, source: "user-entered" as const },
      budget: { monthlyIncome: 2400, monthlySpendingTarget: 1800, expenses: [{ name: "Housing", category: "housing", amount: 900 }] },
    };
    const values = {
      incomeSources: JSON.stringify([
        { name: "Main job gross", type: "employment", amount: 5000, basis: "gross", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: false },
        { name: "Main job take-home", type: "employment", amount: 3600, basis: "net", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true },
        { name: "Side work", type: "self-employment", amount: 300, basis: "net", frequency: "irregular", regularity: "irregular", includeInBudgetEstimate: false },
      ]),
      financialAccounts: JSON.stringify([
        { name: "Checking", accountType: "depository", subtype: "checking", balance: 0, balanceSource: "manual", currency: "USD" },
        { name: "Brokerage", accountType: "investment", subtype: "taxable", balanceSource: "imported", currency: "USD" },
      ]),
      retirementContributionPlans: JSON.stringify([
        { name: "401(k)", destinationAccountName: "Work plan", contribution: { basis: "percentage", percentage: 8, percentageOf: "gross-income", frequency: "monthly" }, employerMatch: { percentage: 50, basis: "employee-contribution", maximumPercentageOfSalary: 4 } },
        { name: "IRA", destinationAccountName: "Traditional IRA", contribution: { basis: "amount", amount: 0, frequency: "monthly" } },
      ]),
      debts: JSON.stringify([{ name: "Auto loan", type: "auto-loan", balance: 12000, annualInterestRatePercent: 5.1, minimumPayment: 300, paymentFrequency: "monthly" }]),
      recurringExpenses: JSON.stringify([{ name: "Insurance", category: "auto", amount: 100, frequency: "monthly", dueDate: "2027-01-05" }]),
      savingsAllocations: JSON.stringify([{ name: "Emergency savings", amount: 0, frequency: "monthly" }]),
      goals: JSON.stringify([{ name: "Reserve", targetAmount: 0, targetDate: "2027-12-31" }]),
    };
    const saved = parseFinancialProfileIntake(form(values), current);
    expect(saved.errors).toEqual({});
    expect(saved.profile?.incomeSources).toHaveLength(3);
    expect(saved.profile?.incomeSources?.[0].includeInBudgetEstimate).toBe(false);
    expect(saved.profile?.incomeSources?.[1].basis).toBe("net");
    expect(saved.profile?.incomeSources?.[2].includeInBudgetEstimate).toBe(false);
    expect(saved.profile?.financialAccounts?.[0].balance).toBe(0);
    expect(saved.profile?.financialAccounts?.[1].balance).toBeUndefined();
    expect(saved.profile?.retirementContributionPlans?.[0].employerMatch?.percentage).toBe(50);
    expect(saved.profile?.retirementContributionPlans?.[1].contribution).toMatchObject({ basis: "amount", amount: 0 });
    expect(saved.profile?.debts?.[0].annualInterestRatePercent).toBe(5.1);
    expect(saved.profile?.recurringExpenses?.[0].frequency).toBe("monthly");
    expect(saved.profile?.savingsAllocations?.[0].amount).toBe(0);
    expect(saved.profile?.goals?.[0].targetAmount).toBe(0);
    expect(saved.profile?.income).toEqual(current.income);
    expect(saved.profile?.paychecks).toEqual(current.paychecks);
    expect(saved.profile?.retirementContributions).toEqual(current.retirementContributions);
    expect(saved.profile?.manualBalances).toEqual(current.manualBalances);
    expect(saved.profile?.budget).toEqual(current.budget);

    const reloaded = parseFinancialProfileIntake(form({
      incomeSources: JSON.stringify(saved.profile?.incomeSources),
      financialAccounts: JSON.stringify(saved.profile?.financialAccounts),
      retirementContributionPlans: JSON.stringify(saved.profile?.retirementContributionPlans),
      debts: JSON.stringify(saved.profile?.debts),
      recurringExpenses: JSON.stringify(saved.profile?.recurringExpenses),
      savingsAllocations: JSON.stringify(saved.profile?.savingsAllocations),
      goals: JSON.stringify(saved.profile?.goals),
    }), JSON.parse(serializeFinancialProfile(saved.profile!)));
    expect(reloaded.profile).toMatchObject({
      incomeSources: saved.profile?.incomeSources,
      financialAccounts: saved.profile?.financialAccounts,
      retirementContributionPlans: saved.profile?.retirementContributionPlans,
      recurringExpenses: saved.profile?.recurringExpenses,
      savingsAllocations: saved.profile?.savingsAllocations,
      goals: saved.profile?.goals,
    });
  });

  it("rejects including gross, unknown, or irregular income in a future recurring budget estimate", () => {
    for (const source of [
      { name: "Gross job", type: "employment", amount: 5000, basis: "gross", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true },
      { name: "Unknown job", type: "employment", basis: "net", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true },
      { name: "Irregular job", type: "employment", amount: 200, basis: "net", frequency: "irregular", regularity: "irregular", includeInBudgetEstimate: true },
    ]) {
      const result = parseFinancialProfileIntake(form({ incomeSources: JSON.stringify([source]) }), STARTER_FINANCIAL_PROFILE);
      expect(result.profile).toBeUndefined();
      expect(result.errors["incomeSources.0.includeInBudgetEstimate"]).toMatch(/known, regular take-home/);
    }
  });

  it("rejects malformed collection frequencies and unsupported account types", () => {
    const result = parseFinancialProfileIntake(form({
      incomeSources: JSON.stringify([{ name: "Job", type: "employment", amount: 1000, basis: "net", frequency: "fortnightly-ish", regularity: "regular" }]),
      recurringExpenses: JSON.stringify([{ name: "Rent", amount: 1000, frequency: "every so often" }]),
      financialAccounts: JSON.stringify([{ name: "Account", accountType: "secret-wallet", balanceSource: "manual" }]),
    }), STARTER_FINANCIAL_PROFILE);
    expect(result.profile).toBeUndefined();
    expect(result.errors.incomeSources).toMatch(/frequency/);
    expect(result.errors.recurringExpenses).toMatch(/frequency/);
    expect(result.errors.financialAccounts).toMatch(/type/);
  });

  it("updates only the authenticated owner's profile row", async () => {
    const versionFilter = { select: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "auth-owner" }, error: null }) };
    const eq = vi.fn().mockReturnValue(versionFilter);
    const is = vi.fn().mockReturnValue(versionFilter);
    const select = vi.fn().mockReturnThis();
    versionFilter.select = select;
    const update = vi.fn().mockReturnValue({ eq: vi.fn((column: string, value: unknown) => {
      eq(column, value);
      return { eq, is };
    }) });
    const client = { from: vi.fn().mockReturnValue({ update }) };
    const profile = { ...STARTER_FINANCIAL_PROFILE, onboardingCompletedAt: "2026-01-01T00:00:00.000Z" };
    const previous = { ...STARTER_FINANCIAL_PROFILE };
    await expect(persistFinancialProfile(client as never, "auth-owner", profile, previous)).resolves.toBe("saved");
    expect(client.from).toHaveBeenCalledWith("profiles");
    expect(eq).toHaveBeenCalledWith("id", "auth-owner");
    expect(eq).toHaveBeenCalledWith("financial_profile", JSON.stringify(previous));
    expect(update.mock.calls[0][0].financial_profile.onboardingCompletedAt).toBe(profile.onboardingCompletedAt);
  });
});
