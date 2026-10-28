import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinancialProfile } from "./financialProfileDefaults";

export type IntakeResult = { profile?: FinancialProfile; errors: Record<string, string>; message?: string };

type Frequency = NonNullable<FinancialProfile["income"]>["frequency"];
const frequencies: readonly Frequency[] = ["weekly", "biweekly", "semimonthly", "monthly", "other"];

function readText(form: FormData, key: string, maxLength = 120): string | undefined {
  const value = String(form.get(key) ?? "").trim();
  return value ? value.slice(0, maxLength) : undefined;
}

function readAmount(form: FormData, key: string, errors: Record<string, string>): number | undefined {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
    errors[key] = "Enter an amount from 0 to 1,000,000,000, or leave it blank if unknown.";
    return undefined;
  }
  return value;
}

function readRows<T>(form: FormData, key: string, errors: Record<string, string>, validate: (row: unknown) => T | null): T[] | undefined {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return undefined;
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 30) throw new Error();
    const result = rows.map(validate);
    if (result.some((row) => row === null)) throw new Error();
    return result as T[];
  } catch {
    errors[key] = "Review these entries. Each row needs a name and valid non-negative amounts.";
    return undefined;
  }
}

export function parseFinancialProfileIntake(form: FormData, current: FinancialProfile): IntakeResult {
  const errors: Record<string, string> = {};
  const personal = {
    fullName: readText(form, "fullName"),
    country: readText(form, "country", 80),
    householdSize: readAmount(form, "householdSize", errors),
  };
  if (personal.householdSize !== undefined && (!Number.isInteger(personal.householdSize) || personal.householdSize < 1 || personal.householdSize > 30)) {
    errors.householdSize = "Household size must be a whole number from 1 to 30.";
  }
  const incomeAmount = readAmount(form, "incomeAmount", errors);
  const rawBasis = String(form.get("incomeBasis") ?? "");
  const basis: "gross" | "take-home" | undefined = rawBasis === "gross" || rawBasis === "take-home" ? rawBasis : undefined;
  const rawFrequency = String(form.get("incomeFrequency") ?? "");
  const frequency = frequencies.includes(rawFrequency as Frequency) ? rawFrequency as Frequency : undefined;
  if (incomeAmount !== undefined && !basis) errors.incomeBasis = "Choose whether this amount is gross or take-home income.";
  if (incomeAmount !== undefined && !frequency) errors.incomeFrequency = "Choose a pay frequency.";
  const currency = readText(form, "currency", 3)?.toUpperCase() ?? current.currency ?? "USD";
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "Choose a valid three-letter currency code.";

  const monthlyExpenses = readRows(form, "monthlyExpenses", errors, (row) => {
    if (!row || typeof row !== "object") return null;
    const item = row as Record<string, unknown>;
    return typeof item.name === "string" && item.name.trim() && typeof item.category === "string" && item.category.trim() && typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount >= 0
      ? { name: item.name.trim().slice(0, 80), category: item.category.trim().slice(0, 80), amount: item.amount }
      : null;
  });
  const monthlySpendingTarget = readAmount(form, "monthlySpendingTarget", errors);
  const debts = readRows(form, "debts", errors, (row) => {
    if (!row || typeof row !== "object") return null;
    const item = row as Record<string, unknown>;
    return typeof item.name === "string" && item.name.trim() && optionalAmount(item.balance) && optionalAmount(item.monthlyPayment)
      ? { name: item.name.trim().slice(0, 80), ...(typeof item.balance === "number" ? { balance: item.balance } : {}), ...(typeof item.monthlyPayment === "number" ? { monthlyPayment: item.monthlyPayment } : {}) }
      : null;
  });
  const goals = readRows(form, "goals", errors, (row) => {
    if (!row || typeof row !== "object") return null;
    const item = row as Record<string, unknown>;
    const date = item.targetDate === "" ? undefined : item.targetDate;
    return typeof item.name === "string" && item.name.trim() && optionalAmount(item.targetAmount) &&
      (date === undefined || (typeof date === "string" && isIsoDate(date)))
      ? { name: item.name.trim().slice(0, 100), ...(typeof item.targetAmount === "number" ? { targetAmount: item.targetAmount } : {}), ...(typeof date === "string" ? { targetDate: date } : {}) }
      : null;
  });

  const cash = readAmount(form, "cashBalance", errors);
  const savings = readAmount(form, "savingsBalance", errors);
  const perPaycheck = readAmount(form, "retirementPerPaycheck", errors);
  const percentIncome = readAmount(form, "retirementPercent", errors);
  const employerMatch = readAmount(form, "employerMatch", errors);
  const retirementDestination = readText(form, "retirementDestination");
  if (percentIncome !== undefined && percentIncome > 100) errors.retirementPercent = "Enter a percentage from 0 to 100.";
  if (employerMatch !== undefined && employerMatch > 100) errors.employerMatch = "Enter a percentage from 0 to 100.";
  const emergencyFund = readAmount(form, "emergencyFundTarget", errors);
  const minimumCashBuffer = readAmount(form, "minimumCashBuffer", errors);

  if (Object.keys(errors).length) return { errors, message: "Please correct the highlighted fields." };
  const takeHomeMonthly = incomeAmount !== undefined && basis === "take-home" ? toMonthly(incomeAmount, frequency!) : undefined;
  const profile: FinancialProfile = {
    ...current,
    label: current.label || "Personal financial profile",
    currency,
    personal: compact(personal),
    income: compact({ amount: incomeAmount, basis, frequency }),
    manualBalances: cash !== undefined || savings !== undefined ? { ...(cash !== undefined ? { cash } : {}), ...(savings !== undefined ? { savings } : {}), source: "user-entered" } : undefined,
    debts,
    savingsTargets: compact({ emergencyFund, minimumCashBuffer }),
    retirementContributions: compact({ destination: retirementDestination, perPaycheck, percentageOfIncome: percentIncome, employerMatchPercentage: employerMatch }),
    budget: {
      ...current.budget,
      monthlyIncome: takeHomeMonthly,
      monthlySpendingTarget,
      expenses: monthlyExpenses,
    },
    goals,
  };
  return { profile, errors: {} };
}

function optionalAmount(value: unknown): boolean {
  return value === undefined || value === "" || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000);
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function toMonthly(amount: number, frequency: Frequency): number | undefined {
  switch (frequency) {
    case "weekly": return amount * 52 / 12;
    case "biweekly": return amount * 26 / 12;
    case "semimonthly": return amount * 2;
    case "monthly": return amount;
    case "other": return undefined;
  }
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function serializeFinancialProfile(profile: FinancialProfile): string {
  return JSON.stringify(profile);
}

/** Ownership is supplied only by the server action's verified auth user. */
export async function persistFinancialProfile(supabase: SupabaseClient, ownerId: string, profile: FinancialProfile): Promise<boolean> {
  const { data, error } = await supabase.from("profiles")
    .update({ financial_profile: JSON.parse(serializeFinancialProfile(profile)) })
    .eq("id", ownerId)
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Unable to save your financial profile.");
  return Boolean(data);
}
