import type { BudgetCategory, BudgetTransaction } from "./discretionaryBudget";
import { discretionary } from "./discretionaryBudget";

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

export const suggestionConfidences = ["high", "medium", "low", "needs_review"] as const;
export type SuggestionConfidence = (typeof suggestionConfidences)[number];
export type ClassificationSuggestion = {
  category: BudgetCategory;
  confidence: SuggestionConfidence;
  evidence: "user_override" | "modern_plaid" | "legacy_plaid" | "merchant_rule" | "insufficient_evidence";
  reason: string;
  weeklyIncludedByDefault: boolean | null;
  requiresApproval: boolean;
  movementRisk: string | null;
};

// Exact legacy paths only. These are preview candidates, never automatic budget inputs.
export const legacyCategorySuggestions = {
  "Payment > Credit Card": { category: "card_payment", check: "card", risk: "Possible credit-card payment" },
  "Payment > Rent": { category: "housing", check: "purchase", risk: null },
  "Food and Drink > Restaurants": { category: "dining", check: "purchase", risk: null },
  "Transfer > Third Party > Venmo": { category: "needs_review", check: "ambiguous", risk: "Possible transfer or reimbursement for a purchase" },
  "Payment": { category: "needs_review", check: "ambiguous", risk: "Unspecified payment; purchase or financial movement unknown" },
  "Transfer > Credit": { category: "needs_review", check: "ambiguous", risk: "Possible transfer, refund or other credit" },
  "Transfer > Payroll": { category: "income", check: "payroll", risk: "Possible payroll credit or payroll reversal" },
  "Service > Financial > Stock Brokers": { category: "investment", check: "broker", risk: "Possible investment movement; not proof of a contribution" },
  "Shops > Pharmacies": { category: "needs_review", check: "ambiguous", risk: null },
  "Travel > Car Service > Ride Share": { category: "needs_review", check: "ambiguous", risk: null },
  "Travel": { category: "needs_review", check: "ambiguous", risk: null },
  "Entertainment": { category: "needs_review", check: "ambiguous", risk: null },
} as const satisfies Record<string, { category: BudgetCategory; check: string; risk: string | null }>;

export function suggestTransactionClassification(
  t: BudgetTransaction,
  accountType?: string | null,
): ClassificationSuggestion {
  const classified = classifyTransaction(t);
  const amount = t.amount == null || String(t.amount).trim() === "" ? NaN : Number(t.amount);
  const credit = Number.isFinite(amount) && amount < 0;
  const result = (
    category: BudgetCategory,
    confidence: SuggestionConfidence,
    evidence: ClassificationSuggestion["evidence"],
    reason: string,
    movementRisk: string | null = null,
  ): ClassificationSuggestion => ({
    category, confidence, evidence,
    reason: `${reason}${t.pending === true ? " Pending activity; not confirmed posted spending." : t.pending == null ? " Posting status unavailable." : ""}`,
    weeklyIncludedByDefault: category === "needs_review" ? null : discretionary.has(category),
    requiresApproval: evidence !== "user_override",
    movementRisk: movementRisk ?? (credit ? "Incoming amount: may be a refund, payment, income or transfer; never automatically netted against spending" :
      ["transfer", "income", "investment", "savings", "card_payment", "debt_payment"].includes(category) ? "Financial movement; verify purpose and direction" : null),
  });
  if (classified.source === "user_override")
    return result(classified.category, "high", "user_override", classified.reason);
  if (classified.source === "provider_primary" || classified.source === "provider_detailed")
    return result(classified.category, classified.confidence === "high" ? "high" : "needs_review", "modern_plaid", classified.reason,
      ["transfer", "income", "investment", "card_payment", "debt_payment"].includes(classified.category) ? "Provider-classified financial movement; verify direction and purpose" : null);
  if (t.plaid_primary_category && t.plaid_detailed_category && !t.plaid_detailed_category.startsWith(`${t.plaid_primary_category}_`))
    return result("needs_review", "needs_review", "insufficient_evidence", classified.reason, "Conflicting provider metadata");
  // Historical rows may contain either joined paths or the original array.
  const raw: unknown = t.category;
  const path = typeof raw === "string" ? raw.trim() : Array.isArray(raw) && raw.every((v) => typeof v === "string") ? raw.join(" > ") : "";
  if (Object.hasOwn(legacyCategorySuggestions, path)) {
    const legacy = legacyCategorySuggestions[path as keyof typeof legacyCategorySuggestions];
    if (legacy.check === "ambiguous")
      return result("needs_review", "needs_review", "legacy_plaid", `Legacy path “${path}” does not establish spending purpose; explicit review required.`, legacy.risk);
    const knownDirection = Number.isFinite(amount) && amount !== 0;
    const supportedAccount = accountType === "depository" || accountType === "credit";
    const supported = knownDirection && (
      legacy.check === "card" ? (accountType === "depository" && amount > 0) || (accountType === "credit" && amount < 0) :
      legacy.check === "payroll" ? accountType === "depository" && amount < 0 :
      legacy.check === "broker" ? accountType === "depository" :
      supportedAccount && amount > 0
    );
    if (legacy.check === "payroll" && !supported)
      return result("needs_review", "needs_review", "legacy_plaid", "Legacy payroll text without an incoming amount into a depository account does not support an income candidate; possible reversal requires review.", legacy.risk);
    return result(legacy.category, supported && t.pending != null ? "medium" : "low", "legacy_plaid",
      `Exact legacy path “${path}”. ${supported ? "Account type and amount direction support this candidate, but do not verify its purpose." : "Account type, amount or direction is missing or ambiguous; do not assume a purchase, income or payment."} Approval is required.`, legacy.risk);
  }
  // A legacy financial/medical/travel path must not fall through to a merchant guess.
  if (path)
    return result("needs_review", "needs_review", "legacy_plaid", "Unmapped legacy category; no broad substring or merchant inference applied.");
  if (classified.source === "merchant_rule")
    return result(classified.category, amount > 0 && t.pending != null ? "medium" : "low", "merchant_rule", classified.reason);
  return result("needs_review", "needs_review", "insufficient_evidence", classified.reason);
}
