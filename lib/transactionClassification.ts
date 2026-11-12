import type { BudgetCategory, BudgetTransaction } from "./discretionaryBudget";

export type Classification = {
  category: BudgetCategory;
  source:
    | "user_override"
    | "provider_detailed"
    | "provider_primary"
    | "merchant_rule"
    | "needs_review";
  confidence: "high" | "review";
  reason: string;
};
const primary: Record<string, BudgetCategory> = {
  FOOD_AND_DRINK: "dining",
  GENERAL_MERCHANDISE: "shopping",
  ENTERTAINMENT: "entertainment",
  INCOME: "income",
  TRANSFER_IN: "transfer",
  TRANSFER_OUT: "transfer",
  LOAN_PAYMENTS: "debt_payment",
  RENT_AND_UTILITIES: "utilities",
};
const detailed: Record<string, BudgetCategory> = {
  FOOD_AND_DRINK_GROCERIES: "groceries",
  FOOD_AND_DRINK_COFFEE: "coffee",
  FOOD_AND_DRINK_BEER_WINE_AND_LIQUOR: "nightlife",
  RENT_AND_UTILITIES_RENT: "housing",
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: "housing",
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: "card_payment",
  GENERAL_MERCHANDISE_DRUGSTORES_AND_PHARMACIES: "needs_review",
  MEDICAL_PHARMACIES_AND_SUPPLEMENTS: "healthcare",
  MEDICAL_PRIMARY_CARE: "healthcare",
  TRANSPORTATION_GAS: "gas",
  PERSONAL_CARE_HAIR_AND_BEAUTY: "personal_care",
  GENERAL_MERCHANDISE_SUPERSTORES: "shopping",
  GENERAL_SERVICES_INSURANCE: "insurance",
  GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT: "tax",
};
export function classifyTransaction(
  t: Pick<
    BudgetTransaction,
    | "category_override"
    | "plaid_primary_category"
    | "plaid_detailed_category"
    | "plaid_category_confidence"
    | "merchant_name"
    | "name"
  >,
): Classification {
  const result = (
    category: BudgetCategory,
    source: Classification["source"],
    reason: string,
  ): Classification => ({
    category,
    source,
    reason,
    confidence: category === "needs_review" ? "review" : "high",
  });
  if (t.category_override)
    return result(
      t.category_override,
      "user_override",
      "Explicit user category correction.",
    );
  const p = t.plaid_primary_category ?? "",
    d = t.plaid_detailed_category ?? "";
  const trusted = ["HIGH", "VERY_HIGH"].includes(
    t.plaid_category_confidence ?? "",
  );
  if (p && d && !d.startsWith(`${p}_`))
    return result(
      "needs_review",
      "needs_review",
      "Provider primary and detailed classifications conflict.",
    );
  if (trusted && Object.hasOwn(detailed, d))
    return result(
      detailed[d],
      "provider_detailed",
      "High-confidence detailed provider classification.",
    );
  // Unrecognized detailed classifications must not turn medical/essential purchases
  // into discretionary shopping. Transfers never use merchant purchase fallbacks.
  if (trusted && Object.hasOwn(primary, p))
    return result(
      primary[p],
      "provider_primary",
      "High-confidence provider primary classification.",
    );
  if (
    p.startsWith("TRANSFER") ||
    p === "LOAN_PAYMENTS" ||
    p === "INCOME" ||
    p === "MEDICAL"
  )
    return result(
      "needs_review",
      "needs_review",
      "Financial movement or medical classification requires reliable provider details.",
    );
  const merchant = (t.merchant_name || t.name).trim();
  if (
    (!p || p === "FOOD_AND_DRINK") &&
    /^bagel express(?: on broadway)?$/i.test(merchant)
  )
    return result(
      "dining",
      "merchant_rule",
      "Narrow reviewed merchant rule: Bagel Express dining.",
    );
  return result(
    "needs_review",
    "needs_review",
    "Unknown or ambiguous purchase; no broad description inference.",
  );
}
