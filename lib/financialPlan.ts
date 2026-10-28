export const ACCOUNT_PURPOSES = ["equities", "retirement", "hysa"] as const;

export type AccountPurpose = (typeof ACCOUNT_PURPOSES)[number];

export type DateInput = string | Date;

export type PlannedPaycheck = {
  date: string;
  netAmount: number;
  rothContribution: number;
  billsAllocation: number;
  weeklySpendingAllocation: number;
  cushion: number;
};

export type PaycheckPlan = {
  netAmount?: number;
  paydays?: readonly string[];
  rothContribution?: number;
  billsAllocation?: number;
  weeklySpendingAllocation?: number;
  cushion?: number;
};

export type RothContributionPlan = {
  destination: string;
  totalRemaining: number;
  contributions: readonly {
    date: string;
    amount: number;
    mayExecuteOnNextTradingDay?: boolean;
  }[];
};

export type BillsPlan = {
  destination?: string;
  reservePurpose: "bills-cash-reserve";
  intendedApy?: number;
  monthlyObligations: {
    rent?: number;
    utilities?: number;
    phone?: number;
    total?: number;
  };
  period?: {
    start: string;
    end: string;
    totalRequired: number;
  };
  perPaycheckAllocation?: number;
};

export type WeeklySpendingPlan = {
  weeklyTarget?: number;
  dailyTarget?: number;
  periodStartDay: "Friday";
  periodEndDay: "Thursday";
  includes: readonly ["subscriptions", "credit-card-purchases"];
  excludes: readonly ["credit-card-payments", "transfers", "investment-activity"];
  venmoBalanceSemantics: "available-liquidity-offset";
};

export type FinancialPlan = {
  currency: string;
  paychecks: PaycheckPlan;
  roth?: RothContributionPlan;
  bills: BillsPlan;
  weeklySpending: WeeklySpendingPlan;
};

export type AccountMetadata = {
  name?: string | null;
  institution?: string | null;
  type?: string | null;
  subtype?: string | null;
  purpose?: AccountPurpose | null;
};

export type SpendingPeriod = {
  start: string;
  end: string;
};

import { STARTER_FINANCIAL_PROFILE, LEGACY_EXAMPLE_FINANCIAL_PROFILE, FinancialProfile } from "./financialProfileDefaults";

function legacyPlan(): FinancialPlan {
  const profile = LEGACY_EXAMPLE_FINANCIAL_PROFILE;
  return {
    currency: profile.currency,
    paychecks: profile.paychecks ?? {},
    roth: profile.roth,
    bills: { reservePurpose: "bills-cash-reserve", ...profile.bills },
    weeklySpending: {
      periodStartDay: "Friday", periodEndDay: "Thursday", includes: ["subscriptions", "credit-card-purchases"],
      excludes: ["credit-card-payments", "transfers", "investment-activity"], venmoBalanceSemantics: "available-liquidity-offset",
      ...profile.weeklySpending,
    },
  } as FinancialPlan;
}

/** Backward-compatible explicit legacy example used by the existing dashboard. */
export const FINANCIAL_PLAN: FinancialPlan = legacyPlan();

function toUtcDate(input: DateInput): Date {
  if (input instanceof Date) {
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (!match) {
    throw new Error(`Expected a date in YYYY-MM-DD format, received: ${input}`);
  }

  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function normalize(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function getConfiguredPaydays(profile: FinancialProfile = STARTER_FINANCIAL_PROFILE): readonly string[] {
  return profile.paychecks?.paydays ?? [];
}

export function getCurrentOrNextPlannedPaycheck(input: DateInput, profile: FinancialProfile = STARTER_FINANCIAL_PROFILE): PlannedPaycheck | null {
  const date = formatDate(toUtcDate(input));
  const payday = getConfiguredPaydays(profile).find((candidate) => candidate >= date);
  return payday ? getPlannedPaycheck(payday, profile) : null;
}

export function getPlannedPaycheck(payday: string, profile: FinancialProfile = STARTER_FINANCIAL_PROFILE): PlannedPaycheck {
  if (!getConfiguredPaydays(profile).includes(payday)) {
    throw new Error(`No planned paycheck exists for ${payday}`);
  }

  const values = profile.paychecks ?? {};
  return {
    date: payday,
    netAmount: values.netAmount ?? 0,
    rothContribution: calculatePlannedRothContribution(payday, profile),
    billsAllocation: values.billsAllocation ?? 0,
    weeklySpendingAllocation: values.weeklySpendingAllocation ?? 0,
    cushion: values.cushion ?? 0,
  };
}

export function getSpendingPeriod(input: DateInput): SpendingPeriod {
  const date = toUtcDate(input);
  const dayOfWeek = date.getUTCDay();
  const daysSinceFriday = (dayOfWeek + 2) % 7;
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - daysSinceFriday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  return { start: formatDate(start), end: formatDate(end) };
}

export function getWeeklySpendingTarget(profile: FinancialProfile = STARTER_FINANCIAL_PROFILE): number | undefined {
  return profile.weeklySpending?.weeklyTarget;
}

export function getPaycheckAllocation(profile: FinancialProfile = STARTER_FINANCIAL_PROFILE): PaycheckPlan {
  return profile.paychecks ?? {};
}

export function calculatePlannedRothContribution(payday: string, profile: FinancialProfile = STARTER_FINANCIAL_PROFILE): number {
  return profile.roth?.contributions.find((contribution) => contribution.date === payday)?.amount ?? profile.paychecks?.rothContribution ?? 0;
}

export function calculateRemainingPlannedRothContributions(asOfDate?: DateInput, profile: FinancialProfile = STARTER_FINANCIAL_PROFILE): number {
  const contributions = profile.roth?.contributions ?? [];
  if (asOfDate === undefined) {
    return contributions.reduce((total, contribution) => total + contribution.amount, 0);
  }

  const date = formatDate(toUtcDate(asOfDate));
  return contributions
    .filter((contribution) => contribution.date >= date)
    .reduce((total, contribution) => total + contribution.amount, 0);
}

export function identifyAccountPurpose(account: AccountMetadata): AccountPurpose | null {
  if (account.purpose) {
    return account.purpose;
  }

  const text = [account.name, account.institution, account.type, account.subtype]
    .map(normalize)
    .join(" ");

  if (text.includes("roth") || text.includes("401k") || text.includes("401(k)") || normalize(account.subtype) === "retirement") {
    return "retirement";
  }

  if (text.includes("hysa") || text.includes("high yield") || text.includes("bills") || text.includes("cash reserve")) {
    return "hysa";
  }

  if (text.includes("taxable") || text.includes("individual") || text.includes("brokerage") || text.includes("portfolio")) {
    return "equities";
  }

  return null;
}
