import { DashboardAccount } from "./dashboard";

export const FINANCIAL_ACCOUNT_PURPOSES = [
  "equities",
  "retirement",
  "hysa",
  "spending",
  "venmo",
  "credit",
  "other",
] as const;

export type FinancialAccountPurpose = (typeof FINANCIAL_ACCOUNT_PURPOSES)[number];

export type AccountPurposeMetadata = Pick<
  DashboardAccount,
  "id" | "institution_name" | "account_name" | "account_type" | "account_subtype"
> & {
  purpose?: FinancialAccountPurpose | null;
};

function normalize(value: unknown): string {
  return String(value ?? "").toLowerCase().trim();
}

export function getAccountPurpose(account: AccountPurposeMetadata): FinancialAccountPurpose {
  if (account.purpose) {
    return account.purpose;
  }

  const institution = normalize(account.institution_name);
  const name = normalize(account.account_name);
  const type = normalize(account.account_type);
  const subtype = normalize(account.account_subtype);
  const text = `${institution} ${name} ${type} ${subtype}`;

  if (
    subtype.includes("roth") ||
    subtype.includes("ira") ||
    subtype.includes("401") ||
    subtype.includes("retirement") ||
    subtype.includes("pension") ||
    text.includes("roth") ||
    text.includes("401k") ||
    text.includes("401(k)")
  ) {
    return "retirement";
  }

  if (
    text.includes("hysa") ||
    text.includes("high yield") ||
    text.includes("cash reserve") ||
    text.includes("bills reserve") ||
    name.includes("bills")
  ) {
    return "hysa";
  }

  if (type === "credit" || subtype.includes("credit") || subtype.includes("card")) {
    return "credit";
  }

  if (institution.includes("venmo") || name.includes("venmo")) {
    return "venmo";
  }

  if (subtype.includes("crypto") || text.includes("crypto") || text.includes("cryptocurrency")) {
    return "other";
  }

  if (institution.includes("bilt") || institution.includes("barclays") || text.includes("bilt card") || text.includes("barclays card")) {
    return "credit";
  }

  if (
    institution.includes("usaa") &&
    (subtype.includes("checking") || subtype.includes("cash") || type === "depository")
  ) {
    return "spending";
  }

  if (text.includes("operating cash") || text.includes("spending account")) {
    return "spending";
  }

  if (
    (institution.includes("robinhood") &&
      (type === "investment" || subtype.includes("brokerage") || subtype.includes("individual") || subtype.includes("taxable") || name.includes("individual brokerage")))
  ) {
    return "equities";
  }

  return "other";
}

export function mapAccountPurposes(accounts: readonly AccountPurposeMetadata[]): Map<string, FinancialAccountPurpose> {
  return new Map(accounts.map((account) => [
    account.id,
    getAccountPurpose(account),
  ]));
}