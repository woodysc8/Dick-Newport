import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BalanceSource,
  DebtProfile,
  FinancialAccountProfile,
  FinancialAccountType,
  FinancialGoalProfile,
  FinancialProfile,
  IncomeSource,
  IncomeSourceType,
  PropertyProfile,
  PropertyType,
  RecurringExpenseProfile,
  RecurringFrequency,
  RetirementContributionProfile,
  RetirementContributionValue,
  SavingsAllocationProfile,
} from "./financialProfileDefaults";
import { normalizeFinancialProfile, validateFinancialProfileCollections } from "./financialProfileNormalization";

export type IntakeResult = { profile?: FinancialProfile; errors: Record<string, string>; message?: string };

type Frequency = Exclude<NonNullable<FinancialProfile["income"]>["frequency"], undefined>;
const frequencies: readonly Frequency[] = ["weekly", "biweekly", "semimonthly", "monthly", "annual", "irregular", "other"];
const recurringFrequencies: readonly RecurringFrequency[] = ["weekly", "biweekly", "semimonthly", "monthly", "annual", "irregular"];
const debtTypes: readonly NonNullable<DebtProfile["type"]>[] = ["credit-card", "student-loan", "mortgage", "auto-loan", "personal-loan", "other"];
const incomeTypes: readonly IncomeSourceType[] = ["employment", "self-employment", "benefit", "rental", "investment", "other"];
const accountTypes: readonly FinancialAccountType[] = ["unknown", "cash", "depository", "credit", "investment", "retirement", "loan", "other"];
const propertyTypes: readonly PropertyType[] = ["primary-residence", "rental", "vacation-secondary-home", "land", "other"];
const balanceSources: readonly BalanceSource[] = ["manual", "imported", "unknown"];

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

function readRows<T>(form: FormData, key: string, errors: Record<string, string>, validate: (row: unknown) => T | null, invalidMessage = "Review these entries. Each row needs a name and valid non-negative amounts."): T[] | undefined {
  const raw = String(form.get(key) ?? "").trim();
  if (!raw) return undefined;
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > 30) throw new Error(invalidMessage);
    const result = rows.map(validate);
    if (result.some((row) => row === null)) throw new Error(invalidMessage);
    return result as T[];
  } catch {
    errors[key] = invalidMessage;
    return undefined;
  }
}

export function parseFinancialProfileIntake(form: FormData, current: FinancialProfile): IntakeResult {
  const errors: Record<string, string> = {};
  const hasPersonalFields = ["fullName", "country", "householdSize"].some((key) => form.has(key));
  const personal = hasPersonalFields ? {
    fullName: readText(form, "fullName"), country: readText(form, "country", 80), householdSize: readAmount(form, "householdSize", errors),
  } : undefined;
  if (personal?.householdSize !== undefined && (!Number.isInteger(personal.householdSize) || personal.householdSize < 1 || personal.householdSize > 30)) {
    errors.householdSize = "Household size must be a whole number from 1 to 30.";
  }
  const hasLegacyIncomeFields = ["incomeAmount", "incomeBasis", "incomeFrequency"].some((key) => form.has(key));
  const incomeAmount = readAmount(form, "incomeAmount", errors);
  const rawBasis = String(form.get("incomeBasis") ?? "");
  const basis: "gross" | "take-home" | undefined = rawBasis === "gross" || rawBasis === "take-home" ? rawBasis : undefined;
  const rawFrequency = String(form.get("incomeFrequency") ?? "");
  const frequency = frequencies.includes(rawFrequency as Frequency) ? rawFrequency as Frequency : undefined;
  if (incomeAmount !== undefined && !basis) errors.incomeBasis = "Choose whether this amount is gross or take-home income.";
  if (incomeAmount !== undefined && !frequency) errors.incomeFrequency = "Choose a pay frequency.";
  const currency = readText(form, "currency", 3)?.toUpperCase() ?? current.currency ?? "USD";
  if (!/^[A-Z]{3}$/.test(currency)) errors.currency = "Choose a valid three-letter currency code.";

  const incomeSources = readRows(form, "incomeSources", errors, parseIncomeSource, "Each income source needs a name and type. Choose gross or net if you enter an amount; check frequency, regularity, and dates.");
  const financialAccounts = readRows(form, "financialAccounts", errors, parseFinancialAccount, "Each account needs a name, valid type, and balance source. Enter a valid currency and balance or leave them blank.");
  const properties = readRows(form, "properties", errors, (row) => parseProperty(row, currency), "Each property needs a stable ID, name, property type, and valid ownership and currency details.");
  const retirementContributionPlans = readRows(form, "retirementContributionPlans", errors, parseRetirementContribution, "Check each contribution format, amount or percentage, frequency, and employer-match details.");
  const recurringExpenses = readRows(form, "recurringExpenses", errors, parseRecurringExpense, "Each recurring expense needs a name and frequency; amounts and due dates must be valid when entered.");
  const savingsAllocations = readRows(form, "savingsAllocations", errors, parseSavingsAllocation, "Each savings allocation needs a name and frequency; enter a non-negative amount or leave it unknown.");
  const monthlyExpenses = readRows(form, "monthlyExpenses", errors, (row) => {
    if (!row || typeof row !== "object") return null;
    const item = row as Record<string, unknown>;
    return typeof item.name === "string" && item.name.trim() && typeof item.category === "string" && item.category.trim() && typeof item.amount === "number" && Number.isFinite(item.amount) && item.amount >= 0
      ? { name: item.name.trim().slice(0, 80), category: item.category.trim().slice(0, 80), amount: item.amount }
      : null;
  });
  const monthlySpendingTarget = readAmount(form, "monthlySpendingTarget", errors);
  const debts = readRows(form, "debts", errors, parseDebt, "Each debt needs a name. Balances, annual rates, payments, and payment frequency must be valid when entered.");
  const goals = readRows(form, "goals", errors, parseGoal, "Each goal needs a name. Targets must be non-negative and dates must be valid.");
  const hasLegacyBalanceFields = ["cashBalance", "savingsBalance"].some((key) => form.has(key));
  const hasLegacyRetirementFields = ["retirementPerPaycheck", "retirementPercent", "employerMatch", "retirementDestination"].some((key) => form.has(key));
  const hasBudgetTarget = form.has("monthlySpendingTarget");
  const hasEmergencyTargets = form.has("emergencyFundTarget") || form.has("minimumCashBuffer");
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
  const takeHomeMonthly = incomeAmount !== undefined && basis === "take-home" && frequency ? toMonthly(incomeAmount, frequency) : undefined;
  const profile = normalizeFinancialProfile({
    ...current,
    label: current.label || "Personal financial profile",
    currency: form.has("currency") ? currency : current.currency,
    ...(personal ? { personal: compact(personal) } : {}),
    ...(hasLegacyIncomeFields ? { income: compact({ amount: incomeAmount, basis, frequency }) } : {}),
    ...(incomeSources !== undefined ? { incomeSources } : {}),
    ...(financialAccounts !== undefined ? { financialAccounts } : {}),
    ...(properties !== undefined ? { properties } : {}),
    ...(retirementContributionPlans !== undefined ? { retirementContributionPlans } : {}),
    ...(hasLegacyBalanceFields ? { manualBalances: cash !== undefined || savings !== undefined ? { ...(cash !== undefined ? { cash } : {}), ...(savings !== undefined ? { savings } : {}), source: "user-entered" as const } : undefined } : {}),
    ...(debts !== undefined ? { debts } : {}),
    ...(hasEmergencyTargets ? { savingsTargets: compact({ emergencyFund, minimumCashBuffer }) } : {}),
    ...(hasLegacyRetirementFields ? { retirementContributions: compact({ destination: retirementDestination, perPaycheck, percentageOfIncome: percentIncome, employerMatchPercentage: employerMatch }) } : {}),
    ...(recurringExpenses !== undefined ? { recurringExpenses } : {}),
    ...(savingsAllocations !== undefined ? { savingsAllocations } : {}),
    ...(goals !== undefined ? { goals } : {}),
    ...(form.has("monthlySpendingTarget") || form.has("monthlyExpenses") || hasLegacyIncomeFields ? {
      budget: {
        ...current.budget,
        ...(hasLegacyIncomeFields ? { monthlyIncome: takeHomeMonthly } : {}),
        ...(hasBudgetTarget ? { monthlySpendingTarget } : {}),
        ...(monthlyExpenses !== undefined ? { expenses: monthlyExpenses } : {}),
      },
    } : {}),
  });
  const collectionErrors = validateFinancialProfileCollections(profile);
  if (Object.keys(collectionErrors).length) return { errors: collectionErrors, message: "Please correct the highlighted profile values." };
  return { profile, errors: {} };
}

function parseIncomeSource(row: unknown): IncomeSource | null {
  if (!isRecord(row) || !validName(row.name)) return null;
  const type = row.type;
  const basis = optionalEnum(row.basis, ["gross", "net"] as const);
  const frequency = optionalEnum(row.frequency, frequencies);
  const regularity = optionalEnum(row.regularity, ["regular", "irregular"] as const);
  const amount = optionalNumber(row.amount);
  const includeInBudgetEstimate = optionalBoolean(row.includeInBudgetEstimate);
  const startDate = optionalDate(row.startDate);
  const endDate = optionalDate(row.endDate);
  if (!incomeTypes.includes(type as IncomeSourceType) || amount === null || (amount !== undefined && !basis) || basis === null || frequency === null || regularity === null || includeInBudgetEstimate === null || startDate === null || endDate === null) return null;
  return {
    name: row.name.trim().slice(0, 100),
    type: type as IncomeSourceType,
    ...(amount !== undefined ? { amount } : {}),
    ...(basis ? { basis } : {}),
    ...(frequency ? { frequency } : {}),
    ...(regularity ? { regularity } : {}),
    ...(includeInBudgetEstimate !== undefined ? { includeInBudgetEstimate } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };
}

function parseFinancialAccount(row: unknown): FinancialAccountProfile | null {
  if (!isRecord(row) || !validName(row.name)) return null;
  const accountType = row.accountType;
  const balanceSource = row.balanceSource;
  const balance = optionalNumber(row.balance, true);
  const subtype = optionalString(row.subtype, 80);
  const institutionLabel = optionalString(row.institutionLabel, 100);
  const currency = optionalString(row.currency, 3)?.toUpperCase();
  if (!accountTypes.includes(accountType as FinancialAccountType) || !balanceSources.includes(balanceSource as BalanceSource) || balance === null || subtype === null || institutionLabel === null || currency === null || (currency && !/^[A-Z]{3}$/.test(currency))) return null;
  return {
    name: row.name.trim().slice(0, 100),
    accountType: accountType as FinancialAccountType,
    balanceSource: balanceSource as BalanceSource,
    ...(subtype ? { subtype } : {}),
    ...(institutionLabel ? { institutionLabel } : {}),
    ...(currency ? { currency } : {}),
    ...(balance !== undefined ? { balance } : {}),
  };
}

function parseProperty(row: unknown, defaultCurrency: string): PropertyProfile | null {
  if (!isRecord(row) || !validName(row.name)) return null;
  const id = optionalString(row.id, 100);
  const propertyType = row.propertyType;
  const estimatedMarketValue = optionalNumber(row.estimatedMarketValue, true);
  const ownershipPercentage = optionalNumber(row.ownershipPercentage);
  const rawCurrency = optionalString(row.currency, 3);
  const currency = rawCurrency === undefined ? defaultCurrency : rawCurrency === null ? null : rawCurrency.toUpperCase();
  const notes = optionalString(row.notes, 500);
  if (!id || !propertyTypes.includes(propertyType as PropertyType) || estimatedMarketValue === null ||
    ownershipPercentage === null || currency === null || notes === null) return null;
  return {
    id,
    name: row.name.trim().slice(0, 100),
    propertyType: propertyType as PropertyType,
    ...(estimatedMarketValue !== undefined ? { estimatedMarketValue } : {}),
    ownershipPercentage: ownershipPercentage ?? 100,
    currency,
    ...(notes ? { notes } : {}),
  };
}

function parseRetirementContribution(row: unknown): RetirementContributionProfile | null {
  if (!isRecord(row) || !isRecord(row.contribution)) return null;
  const value = row.contribution;
  const basis = value.basis;
  const amount = optionalNumber(value.amount);
  const percentage = optionalNumber(value.percentage);
  const frequency = optionalEnum(value.frequency, frequencies);
  const percentageOf = optionalEnum(value.percentageOf, ["gross-income", "net-income", "unknown"] as const);
  if (amount === null || percentage === null || frequency === null || percentageOf === null) return null;
  if (basis !== "amount" && basis !== "percentage" && basis !== "legacy-unresolved") return null;
  if ((basis === "amount" && percentage !== undefined) || (basis === "percentage" && amount !== undefined) || (basis === "percentage" && !percentageOf)) return null;
  const name = optionalString(row.name, 100);
  const destinationAccountName = optionalString(row.destinationAccountName, 100);
  if (!name || destinationAccountName === null) return null;
  let contribution: RetirementContributionValue;
  if (basis === "amount") contribution = { basis, ...(amount !== undefined ? { amount } : {}), ...(frequency ? { frequency } : {}) };
  else if (basis === "percentage") contribution = { basis, ...(percentage !== undefined ? { percentage } : {}), percentageOf: percentageOf!, ...(frequency ? { frequency } : {}) };
  else contribution = { basis, ...(amount !== undefined ? { amount } : {}), ...(percentage !== undefined ? { percentage } : {}), ...(frequency ? { frequency } : {}) };

  let employerMatch: RetirementContributionProfile["employerMatch"];
  if (row.employerMatch !== undefined && row.employerMatch !== null) {
    if (!isRecord(row.employerMatch)) return null;
    const matchPercentage = optionalNumber(row.employerMatch.percentage);
    const maximum = optionalNumber(row.employerMatch.maximumPercentageOfSalary);
    const matchBasis = optionalEnum(row.employerMatch.basis, ["salary", "employee-contribution", "unknown"] as const);
    if (matchPercentage === null || maximum === null || matchBasis === null) return null;
    employerMatch = { ...(matchPercentage !== undefined ? { percentage: matchPercentage } : {}), ...(maximum !== undefined ? { maximumPercentageOfSalary: maximum } : {}), ...(matchBasis ? { basis: matchBasis } : {}) };
  }
  return {
    name,
    ...(destinationAccountName ? { destinationAccountName } : {}),
    contribution,
    ...(employerMatch ? { employerMatch } : {}),
  };
}

function parseDebt(row: unknown): DebtProfile | null {
  if (!isRecord(row) || !validName(row.name)) return null;
  const type = optionalEnum(row.type, debtTypes);
  const paymentFrequency = optionalEnum(row.paymentFrequency, recurringFrequencies);
  const balance = optionalNumber(row.balance);
  const payment = optionalNumber(row.monthlyPayment);
  const minimumPayment = optionalNumber(row.minimumPayment);
  const annualInterestRatePercent = optionalNumber(row.annualInterestRatePercent);
  if (type === null || paymentFrequency === null || balance === null || payment === null || minimumPayment === null || annualInterestRatePercent === null) return null;
  return {
    name: row.name.trim().slice(0, 80),
    ...(type ? { type } : {}), ...(balance !== undefined ? { balance } : {}),
    ...(payment !== undefined ? { monthlyPayment: payment } : {}), ...(minimumPayment !== undefined ? { minimumPayment } : {}),
    ...(annualInterestRatePercent !== undefined ? { annualInterestRatePercent } : {}), ...(paymentFrequency ? { paymentFrequency } : {}),
  };
}

function parseRecurringExpense(row: unknown): RecurringExpenseProfile | null {
  if (!isRecord(row) || !validName(row.name)) return null;
  const frequency = optionalEnum(row.frequency, recurringFrequencies);
  const amount = optionalNumber(row.amount);
  const category = optionalString(row.category, 80);
  const dueDate = optionalDate(row.dueDate);
  if (frequency === null || amount === null || category === null || dueDate === null) return null;
  return { name: row.name.trim().slice(0, 100), ...(frequency ? { frequency } : {}), ...(amount !== undefined ? { amount } : {}), ...(category ? { category } : {}), ...(dueDate ? { dueDate } : {}) };
}

function parseSavingsAllocation(row: unknown): SavingsAllocationProfile | null {
  if (!isRecord(row) || !validName(row.name)) return null;
  const frequency = optionalEnum(row.frequency, [...recurringFrequencies, "per-paycheck"] as const);
  const amount = optionalNumber(row.amount);
  if (frequency === null || amount === null) return null;
  return { name: row.name.trim().slice(0, 100), ...(frequency ? { frequency } : {}), ...(amount !== undefined ? { amount } : {}) };
}

function parseGoal(row: unknown): FinancialGoalProfile | null {
  if (!isRecord(row) || !validName(row.name)) return null;
  const targetAmount = optionalNumber(row.targetAmount);
  const targetDate = optionalDate(row.targetDate);
  if (targetAmount === null || targetDate === null) return null;
  return { name: row.name.trim().slice(0, 100), ...(targetAmount !== undefined ? { targetAmount } : {}), ...(targetDate ? { targetDate } : {}) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalNumber(value: unknown, allowNegative = false): number | undefined | null {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || (!allowNegative && value < 0) || Math.abs(value) > 1_000_000_000) return null;
  return value;
}

function optionalString(value: unknown, maxLength: number): string | undefined | null {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > maxLength) return null;
  return value.trim();
}

function optionalBoolean(value: unknown): boolean | undefined | null {
  return value === undefined ? undefined : typeof value === "boolean" ? value : null;
}

function optionalEnum<const T extends readonly string[]>(value: unknown, options: T): T[number] | undefined | null {
  if (value === undefined || value === "") return undefined;
  return typeof value === "string" && options.includes(value) ? value : null;
}

function optionalDate(value: unknown): string | undefined | null {
  if (value === undefined || value === "") return undefined;
  return typeof value === "string" && isIsoDate(value) ? value : null;
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
    case "annual": return amount / 12;
    case "irregular": return undefined;
    case "other": return undefined;
  }
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

export function serializeFinancialProfile(profile: FinancialProfile): string {
  return JSON.stringify(profile);
}

export type PersistFinancialProfileResult = "saved" | "conflict";

/**
 * Ownership is supplied only by the server action's verified auth user. The
 * JSONB value read for this save is also compared atomically so stale forms
 * cannot silently replace a newer profile.
 */
export async function persistFinancialProfile(
  supabase: SupabaseClient,
  ownerId: string,
  profile: FinancialProfile,
  expectedProfile: unknown,
): Promise<PersistFinancialProfileResult> {
  let update = supabase.from("profiles")
    .update({ financial_profile: JSON.parse(serializeFinancialProfile(profile)) })
    .eq("id", ownerId);

  // PostgREST uses IS NULL for SQL NULL; JSON values are compared as JSONB.
  update = expectedProfile == null
    ? update.is("financial_profile", null)
    : update.eq("financial_profile", JSON.stringify(expectedProfile));

  const { data, error } = await update
    .select("id")
    .maybeSingle();
  if (error) throw new Error("Unable to save your financial profile.");
  return data ? "saved" : "conflict";
}
