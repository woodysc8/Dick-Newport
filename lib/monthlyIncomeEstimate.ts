import type { FinancialProfile, IncomeFrequency, IncomeSource } from "./financialProfileDefaults";

export type IncomeExclusionReason =
  | "not-opted-in"
  | "unknown-amount"
  | "invalid-amount"
  | "gross-income"
  | "irregular-income"
  | "unsupported-frequency";

export type MonthlyIncomeEstimate = {
  estimatedMonthlyTakeHomeIncome: number | null;
  includedSources: Array<{ source: IncomeSource; monthlyAmount: number }>;
  excludedSources: Array<{ source: IncomeSource; reason: IncomeExclusionReason }>;
  complete: boolean;
  partial: boolean;
  status: "complete" | "partial" | "unavailable";
  legacyFallbackUsed: boolean;
};

/** Calendar-year average assumptions: 52 weekly, 26 biweekly, 24 semimonthly pay periods. */
export function toMonthlyIncome(amount: number, frequency: IncomeFrequency): number | null {
  switch (frequency) {
    case "weekly": return amount * 52 / 12;
    case "biweekly": return amount * 26 / 12;
    case "semimonthly": return amount * 24 / 12;
    case "monthly": return amount;
    case "annual": return amount / 12;
    case "irregular":
    case "other":
    default: return null;
  }
}

/**
 * New incomeSources (including []) are authoritative. Without that collection,
 * the legacy budget.monthlyIncome remains the prior budget model's sole income
 * input; legacy income/paychecks continue serving their existing plan displays.
 */
export function estimateMonthlyBudgetIncome(profile: FinancialProfile): MonthlyIncomeEstimate {
  if (profile.incomeSources === undefined) {
    const fallback = profile.budget?.monthlyIncome;
    return {
      estimatedMonthlyTakeHomeIncome: fallback !== undefined && Number.isFinite(fallback) && fallback >= 0 ? fallback : null,
      includedSources: [],
      excludedSources: [],
      complete: fallback !== undefined && Number.isFinite(fallback) && fallback >= 0,
      partial: false,
      status: fallback !== undefined && Number.isFinite(fallback) && fallback >= 0 ? "complete" : "unavailable",
      legacyFallbackUsed: fallback !== undefined && Number.isFinite(fallback) && fallback >= 0,
    };
  }

  const includedSources: MonthlyIncomeEstimate["includedSources"] = [];
  const excludedSources: MonthlyIncomeEstimate["excludedSources"] = [];
  for (const source of profile.incomeSources) {
    let reason: IncomeExclusionReason | undefined;
    if (source.includeInBudgetEstimate !== true) reason = "not-opted-in";
    else if (source.amount === undefined) reason = "unknown-amount";
    else if (!Number.isFinite(source.amount) || source.amount < 0) reason = "invalid-amount";
    else if (source.basis !== "net") reason = "gross-income";
    else if (source.regularity !== "regular" || source.frequency === "irregular") reason = "irregular-income";
    else if (!source.frequency || toMonthlyIncome(source.amount, source.frequency) === null) reason = "unsupported-frequency";
    if (reason) {
      excludedSources.push({ source, reason });
      continue;
    }
    includedSources.push({ source, monthlyAmount: toMonthlyIncome(source.amount!, source.frequency!)! });
  }
  const estimatedMonthlyTakeHomeIncome = profile.incomeSources.length === 0
    ? 0
    : includedSources.length === 0
      ? null
      : includedSources.reduce((total, item) => total + item.monthlyAmount, 0);
  const complete = excludedSources.length === 0;
  const partial = excludedSources.length > 0 && includedSources.length > 0;
  return {
    estimatedMonthlyTakeHomeIncome,
    includedSources,
    excludedSources,
    complete,
    partial,
    status: complete ? "complete" : partial ? "partial" : "unavailable",
    legacyFallbackUsed: false,
  };
}
