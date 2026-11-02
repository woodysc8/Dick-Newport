import type { FinancialAccountProfile, FinancialProfile } from "./financialProfileDefaults";

export type ProfileBalanceClass = "cash" | "investments" | "liabilities" | "unsupported";
export type ProfileBalanceExclusionReason = "unknown-balance" | "invalid-balance" | "unknown-balance-source" | "unsupported-account-type";

export type ProfileAccountBalanceItem = {
  name: string;
  accountType: FinancialAccountProfile["accountType"];
  balance?: number;
  balanceSource: FinancialAccountProfile["balanceSource"];
  balanceClass: ProfileBalanceClass;
  included: boolean;
  exclusionReason?: ProfileBalanceExclusionReason;
};

export type ProfileAccountBalanceSummary = {
  configured: boolean;
  items: ProfileAccountBalanceItem[];
  cash: number | null;
  investments: number | null;
  liabilities: number | null;
  netWorth: number | null;
  complete: boolean;
  excludedCount: number;
};

/** Summarizes configured profile accounts only; legacy manualBalances remain a separate fallback display. */
export function summarizeProfileAccountBalances(profile: FinancialProfile): ProfileAccountBalanceSummary {
  const configuredAccounts = profile.financialAccounts;
  const accounts = configuredAccounts ?? [];
  const totals = {
    cash: { amount: 0, unknown: false },
    investments: { amount: 0, unknown: false },
    liabilities: { amount: 0, unknown: false },
  };
  let unsupported = false;

  const items = accounts.map((account) => {
    const balanceClass = classifyAccount(account.accountType);
    let exclusionReason: ProfileBalanceExclusionReason | undefined;
    if (balanceClass === "unsupported") {
      exclusionReason = "unsupported-account-type";
      unsupported = true;
    } else {
      if (account.balanceSource === "unknown") exclusionReason = "unknown-balance-source";
      else if (account.balance === undefined) exclusionReason = "unknown-balance";
      else if (!Number.isFinite(account.balance) || (account.balance < 0 && !["cash", "depository", "credit"].includes(account.accountType))) exclusionReason = "invalid-balance";

      if (exclusionReason) totals[balanceClass].unknown = true;
      else totals[balanceClass].amount += account.balance!;
    }
    return {
      name: account.name,
      accountType: account.accountType,
      balance: account.balance,
      balanceSource: account.balanceSource,
      balanceClass,
      included: exclusionReason === undefined,
      ...(exclusionReason ? { exclusionReason } : {}),
    };
  });

  const cash = totals.cash.unknown ? null : totals.cash.amount;
  const investments = totals.investments.unknown ? null : totals.investments.amount;
  const liabilities = totals.liabilities.unknown ? null : totals.liabilities.amount;
  const configured = accounts.length > 0;
  const complete = configured && !unsupported && cash !== null && investments !== null && liabilities !== null;

  return {
    configured,
    items,
    cash,
    investments,
    liabilities,
    netWorth: complete ? cash! + investments! - liabilities! : null,
    complete,
    excludedCount: items.filter((item) => !item.included).length,
  };
}

function classifyAccount(type: FinancialAccountProfile["accountType"]): ProfileBalanceClass {
  switch (type) {
    case "cash":
    case "depository": return "cash";
    case "investment":
    case "retirement": return "investments";
    case "credit":
    case "loan": return "liabilities";
    case "unknown":
    case "other":
    default: return "unsupported";
  }
}
