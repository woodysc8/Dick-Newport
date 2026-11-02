import type { FinancialAccountProfile, FinancialProfile, RetirementContributionProfile } from "./financialProfileDefaults";

/**
 * Add collection-based representations for legacy single-value settings.
 * Existing fields are retained so current dashboard calculations continue to
 * work. Explicitly populated collections always take precedence.
 */
export function normalizeFinancialProfile(profile: FinancialProfile): FinancialProfile {
  // Keep absence distinguishable from explicitly configured empty collections.
  const incomeSources = profile.incomeSources;
  const financialAccounts = profile.financialAccounts ?? legacyManualAccounts(profile);
  const retirementContributionPlans = profile.retirementContributionPlans ?? legacyRetirementPlans(profile);

  return {
    ...profile,
    ...(incomeSources !== undefined ? { incomeSources } : {}),
    ...(profile.financialAccounts !== undefined || financialAccounts.length ? { financialAccounts } : {}),
    ...(retirementContributionPlans.length ? { retirementContributionPlans } : {}),
  };
}

function legacyManualAccounts(profile: FinancialProfile): FinancialAccountProfile[] {
  const balances = profile.manualBalances;
  if (!balances) return [];
  const accounts = profile.financialAccounts ?? [];
  const result: FinancialAccountProfile[] = [];
  if (balances.cash !== undefined && !accounts.some(isCashLikeAccount)) {
    result.push({ name: "Cash estimate", accountType: "cash", balance: balances.cash, balanceSource: "manual", currency: profile.currency });
  }
  if (balances.savings !== undefined && !accounts.some(isSavingsLikeAccount)) {
    result.push({ name: "Savings estimate", accountType: "depository", subtype: "savings", balance: balances.savings, balanceSource: "manual", currency: profile.currency });
  }
  return result;
}

function isCashLikeAccount(account: FinancialAccountProfile): boolean {
  const subtype = account.subtype?.toLowerCase() ?? "";
  return account.accountType === "cash" || (account.accountType === "depository" && ["checking", "cash"].includes(subtype));
}

function isSavingsLikeAccount(account: FinancialAccountProfile): boolean {
  const subtype = account.subtype?.toLowerCase() ?? "";
  return account.accountType === "depository" && ["savings", "hysa", "money market"].includes(subtype);
}

function legacyRetirementPlans(profile: FinancialProfile): RetirementContributionProfile[] {
  const legacy = profile.retirementContributions;
  const amount = legacy?.perPaycheck ?? profile.paychecks?.rothContribution;
  const percentage = legacy?.percentageOfIncome;
  const match = legacy?.employerMatchPercentage;
  const destination = legacy?.destination ?? profile.roth?.destination;
  const frequency = profile.paychecks?.frequency;
  if (amount === undefined && percentage === undefined && match === undefined && !destination) return [];

  const contribution: RetirementContributionProfile["contribution"] = amount !== undefined && percentage !== undefined
    ? { basis: "legacy-unresolved", amount, percentage, ...(frequency ? { frequency } : {}) }
    : amount !== undefined
      ? { basis: "amount", amount, ...(frequency ? { frequency } : {}) }
      : percentage !== undefined
        ? { basis: "percentage", percentage, percentageOf: "unknown", ...(frequency ? { frequency } : {}) }
        : { basis: "legacy-unresolved", ...(frequency ? { frequency } : {}) };
  return [{
    name: "Legacy retirement contribution preference",
    ...(destination ? { destinationAccountName: destination } : {}),
    contribution,
    ...(match !== undefined ? { employerMatch: { percentage: match, basis: "unknown" } } : {}),
  }];
}

/** Validate profile configuration without coercing absent or invalid values to zero. */
export function validateFinancialProfileCollections(profile: FinancialProfile): Record<string, string> {
  const errors: Record<string, string> = {};
  const nonNegative = (value: number | undefined): boolean => value === undefined || (Number.isFinite(value) && value >= 0);
  const percent = (value: number | undefined): boolean => nonNegative(value) && (value === undefined || value <= 100);

  profile.incomeSources?.forEach((source, index) => {
    if (!nonNegative(source.amount)) errors[`incomeSources.${index}.amount`] = "Income must be a non-negative amount or left unknown.";
    if (source.frequency !== undefined && !["weekly", "biweekly", "semimonthly", "monthly", "annual", "irregular", "other"].includes(source.frequency)) {
      errors[`incomeSources.${index}.frequency`] = "Choose a supported income frequency.";
    }
    if (source.includeInBudgetEstimate && (source.basis !== "net" || source.amount === undefined || source.regularity !== "regular" || !source.frequency || source.frequency === "irregular" || source.frequency === "other")) {
      errors[`incomeSources.${index}.includeInBudgetEstimate`] = "Only a known, regular take-home income source can be included in a future budget estimate.";
    }
    validateDate(source.startDate, `incomeSources.${index}.startDate`, errors);
    validateDate(source.endDate, `incomeSources.${index}.endDate`, errors);
  });
  profile.financialAccounts?.forEach((account, index) => {
    if (account.balance !== undefined && !Number.isFinite(account.balance)) errors[`financialAccounts.${index}.balance`] = "Enter a finite balance or leave it unknown.";
    if (account.balance !== undefined && account.balance < 0 && !["cash", "depository", "credit"].includes(account.accountType)) {
      errors[`financialAccounts.${index}.balance`] = "This account type needs a non-negative balance; leave it blank if unknown.";
    }
    if (account.balanceSource === "unknown" && account.balance !== undefined) errors[`financialAccounts.${index}.balanceSource`] = "Choose manual or imported for a balance that has been entered.";
    if (account.currency !== undefined && !/^[A-Z]{3}$/.test(account.currency)) errors[`financialAccounts.${index}.currency`] = "Use a three-letter currency code.";
  });
  profile.retirementContributionPlans?.forEach((plan, index) => {
    if (!nonNegative(plan.contribution.amount)) errors[`retirementContributionPlans.${index}.amount`] = "Contribution amounts cannot be negative.";
    if (!percent(plan.contribution.percentage)) errors[`retirementContributionPlans.${index}.percentage`] = "Contribution percentages must be from 0 to 100.";
    if (!percent(plan.employerMatch?.percentage) || !percent(plan.employerMatch?.maximumPercentageOfSalary)) errors[`retirementContributionPlans.${index}.employerMatch`] = "Employer match percentages must be from 0 to 100.";
  });
  profile.debts?.forEach((debt, index) => {
    if (!nonNegative(debt.balance)) errors[`debts.${index}.balance`] = "Debt balances cannot be negative.";
    if (!nonNegative(debt.annualInterestRatePercent)) errors[`debts.${index}.annualInterestRatePercent`] = "Annual interest rates cannot be negative.";
    if (!nonNegative(debt.minimumPayment) || !nonNegative(debt.monthlyPayment)) errors[`debts.${index}.payment`] = "Debt payments cannot be negative.";
  });
  profile.recurringExpenses?.forEach((expense, index) => {
    if (!nonNegative(expense.amount)) errors[`recurringExpenses.${index}.amount`] = "Expense amounts cannot be negative.";
    if (expense.frequency !== undefined && !["weekly", "biweekly", "semimonthly", "monthly", "annual", "irregular"].includes(expense.frequency)) {
      errors[`recurringExpenses.${index}.frequency`] = "Choose a supported recurring expense frequency.";
    }
    validateDate(expense.dueDate, `recurringExpenses.${index}.dueDate`, errors);
  });
  profile.savingsAllocations?.forEach((allocation, index) => {
    if (!nonNegative(allocation.amount)) errors[`savingsAllocations.${index}.amount`] = "Savings allocations cannot be negative.";
  });
  profile.goals?.forEach((goal, index) => {
    if (!nonNegative(goal.targetAmount)) errors[`goals.${index}.targetAmount`] = "Goal targets cannot be negative.";
    validateDate(goal.targetDate, `goals.${index}.targetDate`, errors);
  });
  return errors;
}

function validateDate(value: string | undefined, field: string, errors: Record<string, string>): void {
  if (value === undefined) return;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    errors[field] = "Use a valid YYYY-MM-DD date.";
    return;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    errors[field] = "Use a valid YYYY-MM-DD date.";
  }
}
