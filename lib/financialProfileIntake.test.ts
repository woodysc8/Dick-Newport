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
    expect(result.profile?.income).toEqual({});
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

  it("updates only the authenticated owner's profile row", async () => {
    const eq = vi.fn().mockReturnThis();
    const select = vi.fn().mockReturnThis();
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: "auth-owner" }, error: null });
    const update = vi.fn().mockReturnValue({ eq });
    eq.mockReturnValue({ select, maybeSingle });
    const client = { from: vi.fn().mockReturnValue({ update }) };
    const profile = { ...STARTER_FINANCIAL_PROFILE, onboardingCompletedAt: "2026-01-01T00:00:00.000Z" };
    await expect(persistFinancialProfile(client as never, "auth-owner", profile)).resolves.toBe(true);
    expect(client.from).toHaveBeenCalledWith("profiles");
    expect(eq).toHaveBeenCalledWith("id", "auth-owner");
    expect(update.mock.calls[0][0].financial_profile.onboardingCompletedAt).toBe(profile.onboardingCompletedAt);
  });
});
