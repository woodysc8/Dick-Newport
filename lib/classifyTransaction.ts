export type FinancialType =
  | "income"
  | "spending"
  | "transfer"
  | "credit_card_payment"
  | "refund"
  | "investment"
  | "arbitrage"
  | "gambling"
  | "unknown";

/**
 * These are the categories used by the actual monthly budget.
 *
 * They intentionally match the structure of the user's budget:
 *
 * HOME
 * TRANSPORTATION
 * DAILY LIVING
 * ENTERTAINMENT
 * HEALTH
 * VACATION / HOLIDAY
 * OTHER
 */
export type BudgetCategory =
  // Home
  | "rent"
  | "home_insurance"
  | "electricity"
  | "gas_oil"
  | "water_sewer_trash"
  | "phone"
  | "cable"
  | "internet"
  | "furnishing"
  | "home_maintenance"
  | "home_other"

  // Transportation
  | "uber"
  | "auto_insurance"
  | "fuel"
  | "public_transportation"
  | "auto_maintenance"
  | "transportation_other"

  // Daily Living
  | "groceries"
  | "dining_out"
  | "clothing"
  | "cleaning"
  | "salon_barber"

  // Entertainment
  | "subscriptions"
  | "events"
  | "outdoor_recreation"

  // Health
  | "health_insurance"
  | "gym"
  | "doctors_dentist"
  | "medicine"

  // Vacation / Holiday
  | "airfare"
  | "accommodations"
  | "vacation_food"
  | "souvenirs"
  | "rental_car"

  // General
  | "other"
  | null;

export interface ClassificationResult {
  financial_type: FinancialType;
  budget_category: BudgetCategory;
  include_in_income: boolean;
  include_in_spending: boolean;
  confidence: "high" | "medium" | "low";
  classification_reason: string;
}

export interface ClassificationResultV2 extends ClassificationResult {
  is_income: boolean;
  is_spending: boolean;
  is_transfer: boolean;
  is_credit_card_payment: boolean;
  is_refund: boolean;
  confidence_score: number;
}

function norm(value?: string | null): string {
  return String(value ?? "").toLowerCase().trim();
}

/**
 * Plaid sometimes returns category as an array and sometimes
 * as a string depending on how the transaction was stored.
 */
function normalizeCategory(category: unknown): string {
  if (Array.isArray(category)) {
    return category.map((x) => String(x)).join(" ").toLowerCase();
  }

  return String(category ?? "").toLowerCase();
}

function buildResult(
  financial_type: FinancialType,
  budget_category: BudgetCategory,
  include_in_income: boolean,
  include_in_spending: boolean,
  confidence: "high" | "medium" | "low",
  classification_reason: string,
  confidence_score: number
): ClassificationResultV2 {
  return {
    financial_type,
    budget_category,
    include_in_income,
    include_in_spending,
    confidence,
    classification_reason,
    is_income: financial_type === "income",
    is_spending: include_in_spending,
    is_transfer: financial_type === "transfer",
    is_credit_card_payment: financial_type === "credit_card_payment",
    is_refund: financial_type === "refund",
    confidence_score,
  };
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

const ARBITRAGE_MERCHANTS = [
  "draftkings",
  "fliff",
  "bally bet",
  "ballybet",
  "betrivers",
  "rebet",
  "prophetx",
  "polymarket",
  "kalshi",
];

const GAMBLING_MERCHANTS = [
  "caesars",
  "casino",
  "mgm",
  "betmgm",
];

const TRANSFER_KEYWORDS = [
  "venmo",
  "cash app",
  "cashapp",
  "paypal",
  "transfer",
  "zelle",
  "deposit",
  "withdrawal",
  "ach",
  "p2p",
];

const INVESTMENT_KEYWORDS = [
  "robinhood",
  "schwab",
  "fidelity",
  "vanguard",
];

const CREDIT_PAYMENT_KEYWORDS = [
  "bilt",
  "card payment",
  "credit card payment",
  "cc payment",
  "creditcard",
  "card pmt",
  "pmt",
  "bill pay",
  "billpay",
  "payment received",
];

const PAYROLL_KEYWORDS = [
  "gusto",
  "payroll",
  "paycheck",
  "salary",
  "direct deposit",
];

const REFUND_KEYWORDS = [
  "refund",
  "returned",
  "reversal",
  "reversed",
  "returned payment",
  "refund from",
  "chargeback",
];

/**
 * Classify a transaction into a financial type and,
 * when appropriate, a specific budget category.
 */
export function classifyTransaction(
  tx: any,
  _account?: any
): ClassificationResultV2 {
  const name = norm(tx?.name);
  const merchant = norm(tx?.merchant_name);

  const category = normalizeCategory(tx?.category);

  const nameAndMerchant = `${merchant} ${name}`.trim();
  const allText = `${nameAndMerchant} ${category}`.trim();

  /**
   * Plaid amounts are normally positive for money leaving an account
   * in the data model used by this application, and negative for money
   * coming into an account.
   */
  const amount =
    typeof tx?.amount === "string"
      ? Number(tx.amount)
      : Number(tx?.amount ?? 0);

  const merchantContains = (keywords: string[]) =>
    keywords.some(
      (keyword) =>
        merchant.includes(keyword) ||
        name.includes(keyword)
    );

  // ---------------------------------------------------------------------------
  // 1. ARBITRAGE
  // ---------------------------------------------------------------------------

  /**
   * Arbitrage is intentionally NOT included in normal budget spending.
   *
   * It gets its own financial type so the accounting layer can track it
   * separately.
   */
  if (merchantContains(ARBITRAGE_MERCHANTS)) {
    return buildResult(
      "arbitrage",
      null,
      false,
      false,
      "high",
      `Matched arbitrage merchant: ${merchant || name}`,
      0.98
    );
  }

  // ---------------------------------------------------------------------------
  // 2. CREDIT CARD PAYMENTS
  // ---------------------------------------------------------------------------

  /**
   * A payment to a credit card is NOT spending.
   *
   * The original purchase is spending. Paying the card is simply moving
   * money from checking to the credit-card account.
   *
   * This must happen before generic transfer detection.
   */
  if (
    merchantContains(CREDIT_PAYMENT_KEYWORDS) ||
    category.includes("credit card") ||
    (
      category.includes("payment") &&
      (
        category.includes("credit") ||
        name.includes("card") ||
        name.includes("pmt")
      )
    ) ||
    name.includes("bill pay") ||
    name.includes("payment received")
  ) {
    return buildResult(
      "credit_card_payment",
      null,
      false,
      false,
      "high",
      `Matched credit card payment: ${merchant || name}`,
      0.97
    );
  }

  // ---------------------------------------------------------------------------
  // 3. GAMBLING
  // ---------------------------------------------------------------------------

  /**
   * Casino/gambling activity is considered actual spending,
   * but it lives under Entertainment rather than normal food/shopping.
   *
   * Sportsbook/arbitrage merchants were handled above.
   */
  if (
    merchantContains(GAMBLING_MERCHANTS) ||
    category.includes("gambling") ||
    name.includes("casino")
  ) {
    return buildResult(
      "gambling",
      "events",
      false,
      true,
      "high",
      `Matched gambling merchant/category: ${merchant || name}`,
      0.92
    );
  }

  // ---------------------------------------------------------------------------
  // 4. INVESTMENTS
  // ---------------------------------------------------------------------------

  /**
   * Money moving into Robinhood/Fidelity/etc. is investment activity,
   * not monthly spending.
   */
  if (
    merchantContains(INVESTMENT_KEYWORDS) ||
    category.includes("investment") ||
    name.includes("investment")
  ) {
    return buildResult(
      "investment",
      null,
      false,
      false,
      "high",
      `Matched investment merchant/category: ${merchant || name}`,
      0.95
    );
  }

  // ---------------------------------------------------------------------------
  // 5. INCOME
  // ---------------------------------------------------------------------------

  if (
    merchantContains(PAYROLL_KEYWORDS) ||
    category.includes("payroll") ||
    category.includes("salary") ||
    name.includes("check deposit") ||
    name.includes("paycheck") ||
    name.includes("salary")
  ) {
    return buildResult(
      "income",
      null,
      true,
      false,
      "high",
      `Matched payroll/income transaction: ${merchant || name}`,
      0.97
    );
  }

  // ---------------------------------------------------------------------------
  // 6. REFUNDS
  // ---------------------------------------------------------------------------

  /**
   * A refund is not treated as normal spending.
   *
   * We require explicit refund/reversal language instead of assuming
   * that a negative amount is automatically a refund.
   */
  if (containsAny(allText, REFUND_KEYWORDS)) {
    return buildResult(
      "refund",
      null,
      false,
      false,
      "high",
      `Matched refund/reversal: ${allText}`,
      0.95
    );
  }

  // ---------------------------------------------------------------------------
  // 7. TRANSFERS
  // ---------------------------------------------------------------------------

  /**
   * P2P and account transfers do not count against a budget.
   */
  if (
    merchantContains(TRANSFER_KEYWORDS) ||
    category.includes("transfer") ||
    name.includes("transfer") ||
    name.includes("withdrawal") ||
    name.includes("deposit")
  ) {
    return buildResult(
      "transfer",
      null,
      false,
      false,
      "medium",
      `Matched transfer-like transaction: ${merchant || name}`,
      0.85
    );
  }

  // ---------------------------------------------------------------------------
  // 8. HOME
  // ---------------------------------------------------------------------------

  // Rent / mortgage
  if (
    containsAny(allText, [
      "rent",
      "mortgage",
      "property management",
      "apartment rent",
      "housing payment",
    ])
  ) {
    return buildResult(
      "spending",
      "rent",
      false,
      true,
      "high",
      `Matched housing/rent transaction: ${merchant || name}`,
      0.95
    );
  }

  // Home / rental insurance
  if (
    containsAny(allText, [
      "home insurance",
      "renters insurance",
      "renter insurance",
      "property insurance",
    ])
  ) {
    return buildResult(
      "spending",
      "home_insurance",
      false,
      true,
      "high",
      `Matched home insurance transaction: ${merchant || name}`,
      0.94
    );
  }

  // Electricity
  if (
    containsAny(allText, [
      "electric",
      "electricity",
      "national grid",
      "utility electric",
    ])
  ) {
    return buildResult(
      "spending",
      "electricity",
      false,
      true,
      "high",
      `Matched electricity transaction: ${merchant || name}`,
      0.93
    );
  }

  // Gas / oil
  if (
    containsAny(allText, [
      "gas utility",
      "natural gas",
      "heating oil",
      "oil company",
      "propane",
    ])
  ) {
    return buildResult(
      "spending",
      "gas_oil",
      false,
      true,
      "high",
      `Matched gas/oil transaction: ${merchant || name}`,
      0.92
    );
  }

  // Water / sewer / trash
  if (
    containsAny(allText, [
      "water",
      "sewer",
      "trash",
      "waste management",
      "sanitation",
    ])
  ) {
    return buildResult(
      "spending",
      "water_sewer_trash",
      false,
      true,
      "high",
      `Matched water/sewer/trash transaction: ${merchant || name}`,
      0.88
    );
  }

  // Phone
  if (
    containsAny(allText, [
      "verizon",
      "t-mobile",
      "tmobile",
      "at&t",
      "att wireless",
      "mint mobile",
      "visible",
      "phone bill",
      "mobile phone",
      "wireless",
    ])
  ) {
    return buildResult(
      "spending",
      "phone",
      false,
      true,
      "high",
      `Matched phone/wireless transaction: ${merchant || name}`,
      0.90
    );
  }

  // Cable / satellite
  if (
    containsAny(allText, [
      "cable",
      "satellite",
      "directv",
      "dish network",
      "xfinity tv",
    ])
  ) {
    return buildResult(
      "spending",
      "cable",
      false,
      true,
      "high",
      `Matched cable/satellite transaction: ${merchant || name}`,
      0.90
    );
  }

  // Internet
  if (
    containsAny(allText, [
      "internet",
      "broadband",
      "fios",
      "xfinity",
      "comcast",
      "spectrum internet",
    ])
  ) {
    return buildResult(
      "spending",
      "internet",
      false,
      true,
      "high",
      `Matched internet transaction: ${merchant || name}`,
      0.90
    );
  }

  // Furnishing / appliances
  if (
    containsAny(allText, [
      "ikea",
      "wayfair",
      "homegoods",
      "home goods",
      "lowe's",
      "lowes",
      "home depot",
      "appliance",
      "furniture",
      "furnishing",
    ])
  ) {
    return buildResult(
      "spending",
      "furnishing",
      false,
      true,
      "medium",
      `Matched home furnishing/appliance transaction: ${merchant || name}`,
      0.82
    );
  }

  // Home maintenance
  if (
    containsAny(allText, [
      "plumber",
      "plumbing",
      "contractor",
      "handyman",
      "home repair",
      "maintenance",
      "landscaping",
    ])
  ) {
    return buildResult(
      "spending",
      "home_maintenance",
      false,
      true,
      "medium",
      `Matched home maintenance transaction: ${merchant || name}`,
      0.80
    );
  }

  // ---------------------------------------------------------------------------
  // 9. TRANSPORTATION
  // ---------------------------------------------------------------------------

  // Uber / rideshare
  if (
    containsAny(allText, [
      "uber",
      "lyft",
      "rideshare",
    ])
  ) {
    return buildResult(
      "spending",
      "uber",
      false,
      true,
      "high",
      `Matched rideshare transaction: ${merchant || name}`,
      0.95
    );
  }

  // Auto insurance
  if (
    containsAny(allText, [
      "auto insurance",
      "car insurance",
      "geico",
      "progressive insurance",
      "state farm auto",
      "allstate auto",
    ])
  ) {
    return buildResult(
      "spending",
      "auto_insurance",
      false,
      true,
      "high",
      `Matched auto insurance transaction: ${merchant || name}`,
      0.92
    );
  }

  // Fuel
  if (
    containsAny(allText, [
      "shell",
      "exxon",
      "mobil",
      "sunoco",
      "speedway",
      "wawa",
      "gas station",
      "fuel",
      "gasoline",
    ])
  ) {
    return buildResult(
      "spending",
      "fuel",
      false,
      true,
      "high",
      `Matched fuel transaction: ${merchant || name}`,
      0.88
    );
  }

  // Public transportation
  if (
    containsAny(allText, [
      "ripta",
      "wanderu",
      "amtrak",
      "mbta",
      "metro",
      "bus",
      "train",
      "transit",
      "public transportation",
      "subway",
      "commuter rail",
    ])
  ) {
    return buildResult(
      "spending",
      "public_transportation",
      false,
      true,
      "high",
      `Matched public transportation transaction: ${merchant || name}`,
      0.94
    );
  }

  // Auto maintenance
  if (
    containsAny(allText, [
      "auto repair",
      "car repair",
      "oil change",
      "tire",
      "tires",
      "mechanic",
      "automotive repair",
    ])
  ) {
    return buildResult(
      "spending",
      "auto_maintenance",
      false,
      true,
      "medium",
      `Matched auto maintenance transaction: ${merchant || name}`,
      0.85
    );
  }

  // ---------------------------------------------------------------------------
  // 10. DAILY LIVING
  // ---------------------------------------------------------------------------

  // Groceries
  if (
    containsAny(allText, [
      "grocery",
      "groceries",
      "supermarket",
      "market basket",
      "stop & shop",
      "stop and shop",
      "whole foods",
      "trader joe",
      "aldi",
      "wegmans",
      "shaw's",
      "shaws",
      "walmart",
      "target",
    ]) ||
    category.includes("grocery")
  ) {
    return buildResult(
      "spending",
      "groceries",
      false,
      true,
      "high",
      `Matched grocery transaction: ${merchant || name}`,
      0.92
    );
  }

  // Dining out / restaurants
  if (
    category.includes("restaurant") ||
    category.includes("food and drink") ||
    containsAny(allText, [
      "restaurant",
      "bar",
      "tavern",
      "grill",
      "cafe",
      "coffee",
      "diner",
      "pizza",
      "doordash",
      "uber eats",
      "ubereats",
      "grubhub",
      "seamless",
      "chick-fil-a",
      "mcdonald",
      "chipotle",
      "panera",
      "starbucks",
    ])
  ) {
    return buildResult(
      "spending",
      "dining_out",
      false,
      true,
      "high",
      `Matched dining/restaurant transaction: ${merchant || name}`,
      0.90
    );
  }

  // Clothing
  if (
    containsAny(allText, [
      "clothing",
      "apparel",
      "old navy",
      "gap",
      "h&m",
      "nike",
      "adidas",
      "foot locker",
      "zara",
      "tj maxx",
      "marshalls",
    ])
  ) {
    return buildResult(
      "spending",
      "clothing",
      false,
      true,
      "medium",
      `Matched clothing transaction: ${merchant || name}`,
      0.82
    );
  }

  // Cleaning / laundry
  if (
    containsAny(allText, [
      "laundry",
      "laundromat",
      "dry cleaning",
      "dry cleaner",
      "cleaning service",
      "automatic laundry",
    ])
  ) {
    return buildResult(
      "spending",
      "cleaning",
      false,
      true,
      "medium",
      `Matched cleaning/laundry transaction: ${merchant || name}`,
      0.86
    );
  }

  // Salon / barber
  if (
    containsAny(allText, [
      "barber",
      "haircut",
      "hair salon",
      "salon",
      "great clips",
      "supercuts",
    ])
  ) {
    return buildResult(
      "spending",
      "salon_barber",
      false,
      true,
      "high",
      `Matched salon/barber transaction: ${merchant || name}`,
      0.90
    );
  }

  // ---------------------------------------------------------------------------
  // 11. ENTERTAINMENT
  // ---------------------------------------------------------------------------

  // Subscriptions
  if (
    containsAny(allText, [
      "netflix",
      "spotify",
      "hulu",
      "disney+",
      "disney plus",
      "amazon prime",
      "prime video",
      "max",
      "hbo",
      "apple music",
      "youtube premium",
      "subscription",
      "monthly membership",
    ])
  ) {
    return buildResult(
      "spending",
      "subscriptions",
      false,
      true,
      "high",
      `Matched subscription transaction: ${merchant || name}`,
      0.94
    );
  }

  // Events
  if (
    containsAny(allText, [
      "ticket",
      "tickets",
      "concert",
      "cinema",
      "movie theater",
      "theater",
      "eventbrite",
      "stubhub",
      "ticketmaster",
      "live nation",
      "museum",
    ])
  ) {
    return buildResult(
      "spending",
      "events",
      false,
      true,
      "medium",
      `Matched entertainment/event transaction: ${merchant || name}`,
      0.84
    );
  }

  // Outdoor recreation
  if (
    containsAny(allText, [
      "golf",
      "ski",
      "snowboard",
      "camping",
      "outdoor",
      "recreation",
      "hiking",
      "sporting goods",
      "bass pro",
      "rei",
    ])
  ) {
    return buildResult(
      "spending",
      "outdoor_recreation",
      false,
      true,
      "medium",
      `Matched recreation transaction: ${merchant || name}`,
      0.80
    );
  }

  // ---------------------------------------------------------------------------
  // 12. HEALTH
  // ---------------------------------------------------------------------------

  // Health insurance
  if (
    containsAny(allText, [
      "health insurance",
      "medical insurance",
      "health plan",
      "blue cross",
      "bluecross",
      "aetna",
      "cigna",
      "united healthcare",
      "unitedhealthcare",
    ])
  ) {
    return buildResult(
      "spending",
      "health_insurance",
      false,
      true,
      "high",
      `Matched health insurance transaction: ${merchant || name}`,
      0.92
    );
  }

  // Gym
  if (
    containsAny(allText, [
      "gym",
      "fitness",
      "planet fitness",
      "equinox",
      "ymca",
      "la fitness",
      "anytime fitness",
      "workout",
    ])
  ) {
    return buildResult(
      "spending",
      "gym",
      false,
      true,
      "high",
      `Matched gym/fitness transaction: ${merchant || name}`,
      0.92
    );
  }

  // Doctors / dentist
  if (
    containsAny(allText, [
      "doctor",
      "physician",
      "dentist",
      "dental",
      "hospital",
      "clinic",
      "urgent care",
      "medical",
    ])
  ) {
    return buildResult(
      "spending",
      "doctors_dentist",
      false,
      true,
      "high",
      `Matched medical visit transaction: ${merchant || name}`,
      0.90
    );
  }

  // Medicine / prescriptions
  if (
    containsAny(allText, [
      "pharmacy",
      "prescription",
      "walgreens",
      "cvs",
      "rite aid",
      "medicine",
      "drug store",
    ])
  ) {
    return buildResult(
      "spending",
      "medicine",
      false,
      true,
      "high",
      `Matched pharmacy/medicine transaction: ${merchant || name}`,
      0.90
    );
  }

  // ---------------------------------------------------------------------------
  // 13. VACATION / HOLIDAY
  // ---------------------------------------------------------------------------

  // Airfare
  if (
    containsAny(allText, [
      "airline",
      "airways",
      "delta",
      "united airlines",
      "american airlines",
      "jetblue",
      "southwest",
      "spirit airlines",
      "frontier airlines",
      "airfare",
      "flight",
    ])
  ) {
    return buildResult(
      "spending",
      "airfare",
      false,
      true,
      "high",
      `Matched airfare transaction: ${merchant || name}`,
      0.90
    );
  }

  // Accommodations
  if (
    containsAny(allText, [
      "hotel",
      "airbnb",
      "vrbo",
      "lodging",
      "resort",
      "accommodation",
      "marriott",
      "hilton",
      "hyatt",
    ])
  ) {
    return buildResult(
      "spending",
      "accommodations",
      false,
      true,
      "high",
      `Matched accommodation transaction: ${merchant || name}`,
      0.90
    );
  }

  // Vacation rental car
  if (
    containsAny(allText, [
      "rental car",
      "car rental",
      "hertz",
      "enterprise rent",
      "avis",
      "budget rent a car",
      "national car rental",
      "alamo",
    ])
  ) {
    return buildResult(
      "spending",
      "rental_car",
      false,
      true,
      "high",
      `Matched rental car transaction: ${merchant || name}`,
      0.90
    );
  }

  // ---------------------------------------------------------------------------
  // 14. PLAID CATEGORY FALLBACKS
  // ---------------------------------------------------------------------------

  /**
   * These are deliberately broad fallbacks.
   *
   * Specific merchant rules above always win.
   */

  if (
    category.includes("travel") ||
    category.includes("airline")
  ) {
    return buildResult(
      "spending",
      "airfare",
      false,
      true,
      "medium",
      `Mapped travel category to airfare: ${tx?.category}`,
      0.65
    );
  }

  if (
    category.includes("lodging") ||
    category.includes("hotel")
  ) {
    return buildResult(
      "spending",
      "accommodations",
      false,
      true,
      "medium",
      `Mapped lodging category to accommodations: ${tx?.category}`,
      0.70
    );
  }

  if (
    category.includes("transportation") ||
    category.includes("transit")
  ) {
    return buildResult(
      "spending",
      "public_transportation",
      false,
      true,
      "medium",
      `Mapped transportation category to public transportation: ${tx?.category}`,
      0.65
    );
  }

  if (
    category.includes("pharmacy") ||
    category.includes("medical")
  ) {
    return buildResult(
      "spending",
      "medicine",
      false,
      true,
      "medium",
      `Mapped medical/pharmacy category to medicine: ${tx?.category}`,
      0.65
    );
  }

  if (
    category.includes("entertainment") ||
    category.includes("recreation")
  ) {
    return buildResult(
      "spending",
      "events",
      false,
      true,
      "medium",
      `Mapped entertainment category to events: ${tx?.category}`,
      0.60
    );
  }

  if (
    category.includes("shopping") ||
    category.includes("shops") ||
    category.includes("retail")
  ) {
    return buildResult(
      "spending",
      "other",
      false,
      true,
      "low",
      `Mapped generic shopping category to other: ${tx?.category}`,
      0.45
    );
  }

  // ---------------------------------------------------------------------------
  // 15. FALLBACK
  // ---------------------------------------------------------------------------

  /**
   * Do NOT guess that an unknown transaction is spending.
   *
   * This is important for the budget system because guessing incorrectly
   * would make the user's "Actual" numbers unreliable.
   */
  return buildResult(
    "unknown",
    "other",
    false,
    false,
    "low",
    `No strong classification pattern matched: ${merchant || name || "Unknown transaction"}`,
    0.30
  );
}

export default classifyTransaction;



