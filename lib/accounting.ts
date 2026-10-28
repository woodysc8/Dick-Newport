/*
 * ============================================================
 * ACCOUNTING ENGINE
 * ============================================================
 *
 * Handles:
 * - Account balances
 * - Monthly income
 * - Monthly spending
 * - Transfers
 * - Credit card payments
 * - Refunds
 * - Investments
 * - Spending by budget category
 *
 * Budget categories are normalized to the categories used by
 * lib/budget.ts.
 * ============================================================
 */

/*
 * ============================================================
 * TYPES
 * ============================================================
 */

export interface SpendingCategoryTotal {
  category: string;
  total: number;
}

export interface MonthlyAccounting {
  income: number;
  grossSpending: number;
  spending: number;
  transfers: number;
  creditCardPayments: number;
  refunds: number;
  investmentActivity: number;
  pendingSpending: number;
  spendingByCategory: SpendingCategoryTotal[];
}

export interface AccountSummary {
  cash: number | null;
  investments: number | null;
  crypto: number | null;
  credit: number | null;
  netWorth: number | null;
}

export interface DashboardBudgetCategoryTotal {
  label: string;
  total: number;
}

/*
 * ============================================================
 * HELPERS
 * ============================================================
 */

function toNumber(value: unknown): number {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : 0;
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .trim();
}

function getTransactionText(tx: any): string {
  return [
    tx?.merchant_name,
    tx?.name,
    Array.isArray(tx?.category)
      ? tx.category.join(" ")
      : tx?.category,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function getPlaidCategory(tx: any): string {
  if (Array.isArray(tx?.category)) {
    return tx.category
      .join(" ")
      .toLowerCase();
  }

  return normalize(tx?.category);
}

/*
 * Plaid normally represents:
 *
 * positive amount = money leaving account
 * negative amount = money entering account
 *
 * Therefore positive amounts are spending.
 */

function getSpendingAmount(tx: any): number {
  const amount = toNumber(tx?.amount);

  return amount > 0
    ? amount
    : 0;
}

/*
 * ============================================================
 * TRANSACTION TYPE DETECTION
 * ============================================================
 */

function isCreditCardPayment(tx: any): boolean {
  const text = getTransactionText(tx);
  const category = getPlaidCategory(tx);

  return (
    text.includes("card payment") ||
    text.includes("credit card payment") ||
    text.includes("creditcard") ||
    text.includes("card pmt") ||
    text.includes("bill pay") ||
    text.includes("billpay") ||
    text.includes("bilt card pmt") ||
    (
      category.includes("payment") &&
      (
        category.includes("credit") ||
        text.includes("card") ||
        text.includes("pmt")
      )
    )
  );
}

function isTransfer(tx: any): boolean {
  const text = getTransactionText(tx);
  const category = getPlaidCategory(tx);

  /*
   * IMPORTANT:
   *
   * Do not treat every "deposit" as a transfer.
   * Payroll/income gets checked separately.
   */

  return (
    isVenmoP2P(tx) ||
    text.includes("cash app") ||
    text.includes("cashapp") ||
    text.includes("paypal") ||
    text.includes("zelle") ||
    category.includes("transfer") ||
    text.includes("transfer") ||
    text.includes("withdrawal")
  );
}

export type VenmoTransaction = {
  amount?: unknown;
  pending?: boolean | null;
  merchant_name?: unknown;
  name?: unknown;
  category?: unknown;
};

function isVenmoP2P(tx: VenmoTransaction): boolean {
  return getTransactionText(tx).includes("venmo");
}

export function isIncomingVenmoDiningReimbursement(tx: VenmoTransaction): boolean {
  const amount = toNumber(tx?.amount);

  return (
    amount < 0 &&
    isVenmoP2P(tx) &&
    !tx?.pending &&
    Math.abs(amount) < 100
  );
}

function isIncome(tx: any): boolean {
  const text = getTransactionText(tx);
  const category = getPlaidCategory(tx);

  return (
    text.includes("payroll") ||
    text.includes("paycheck") ||
    text.includes("salary") ||
    text.includes("gusto") ||
    text.includes("direct deposit") ||
    text.includes("check deposit") ||
    category.includes("payroll") ||
    category.includes("salary")
  );
}

function isInvestment(tx: any): boolean {
  const text = getTransactionText(tx);
  const category = getPlaidCategory(tx);

  return (
    text.includes("robinhood") ||
    text.includes("schwab") ||
    text.includes("fidelity") ||
    text.includes("vanguard") ||
    category.includes("investment")
  );
}

function isRefund(tx: any): boolean {
  const text = getTransactionText(tx);

  return (
    text.includes("refund") ||
    text.includes("returned") ||
    text.includes("reversal") ||
    text.includes("reversed") ||
    text.includes("chargeback")
  );
}

function isArbitrage(tx: any): boolean {
  const text = getTransactionText(tx);

  const merchants = [
    "draftkings",
    "fliff",
    "bally bet",
    "ballybet",
    "betrivers",
    "rebet",
    "prophetx",
    "polymarket",
  ];

  return merchants.some(
    (merchant) =>
      text.includes(merchant)
  );
}

function isGambling(tx: any): boolean {
  const text = getTransactionText(tx);
  const category = getPlaidCategory(tx);

  return (
    text.includes("caesars") ||
    text.includes("casino") ||
    text.includes("mgm") ||
    text.includes("betmgm") ||
    category.includes("gambling")
  );
}

/*
 * ============================================================
 * BUDGET CATEGORY MAPPING
 * ============================================================
 *
 * These values MUST match the categories in lib/budget.ts.
 * ============================================================
 */

function getBudgetCategory(
  tx: any
): string | null {
  const text = getTransactionText(tx);
  const category = getPlaidCategory(tx);

  /*
   * ----------------------------------------------------------
   * ARBITRAGE
   * ----------------------------------------------------------
   */

  if (isArbitrage(tx)) {
    return null;
  }

  /*
   * ----------------------------------------------------------
   * GAMBLING
   * ----------------------------------------------------------
   */

  if (isGambling(tx)) {
    return "events";
  }

  /*
   * ----------------------------------------------------------
   * GROCERIES
   * ----------------------------------------------------------
   */

  if (
    category.includes("grocery") ||
    category.includes("groceries") ||
    text.includes("whole foods") ||
    text.includes("trader joe") ||
    text.includes("stop & shop") ||
    text.includes("market basket") ||
    text.includes("shaw") ||
    text.includes("wegmans") ||
    text.includes("aldi")
  ) {
    return "groceries";
  }

  /*
   * ----------------------------------------------------------
   * DINING OUT
   * ----------------------------------------------------------
   *
   * Restaurants and bars belong to Dining Out.
   */

  if (
    category.includes("restaurant") ||
    category.includes("food and drink") ||
    category.includes("bar") ||
    category.includes("cafe") ||
    category.includes("coffee")
  ) {
    return "dining_out";
  }

  /*
   * ----------------------------------------------------------
   * UBER / LYFT
   * ----------------------------------------------------------
   */

  if (
    text.includes("uber") ||
    text.includes("lyft")
  ) {
    return "uber";
  }

  /*
   * ----------------------------------------------------------
   * PUBLIC TRANSPORTATION
   * ----------------------------------------------------------
   */

  if (
    text.includes("ripta") ||
    text.includes("wanderu") ||
    category.includes("public transportation") ||
    category.includes("public transit") ||
    category.includes("train") ||
    category.includes("bus")
  ) {
    return "public_transportation";
  }

  /*
   * ----------------------------------------------------------
   * FUEL
   * ----------------------------------------------------------
   */

  if (
    category.includes("gas") ||
    category.includes("fuel") ||
    text.includes("shell") ||
    text.includes("exxon") ||
    text.includes("mobil") ||
    text.includes("speedway") ||
    text.includes("sunoco")
  ) {
    return "fuel";
  }

  /*
   * ----------------------------------------------------------
   * HEALTH / MEDICINE
   * ----------------------------------------------------------
   */

  if (
    category.includes("pharmacy") ||
    category.includes("pharmacies") ||
    text.includes("walgreens") ||
    text.includes("cvs") ||
    text.includes("rite aid")
  ) {
    return "medicine";
  }

  /*
   * ----------------------------------------------------------
   * DOCTORS / DENTIST
   * ----------------------------------------------------------
   */

  if (
    category.includes("doctor") ||
    category.includes("dentist") ||
    category.includes("medical") ||
    category.includes("healthcare")
  ) {
    return "doctors_dentist";
  }

  /*
   * ----------------------------------------------------------
   * GYM
   * ----------------------------------------------------------
   */

  if (
    text.includes("gym") ||
    text.includes("planet fitness") ||
    text.includes("crunch fitness") ||
    text.includes("ymca")
  ) {
    return "gym";
  }

  /*
   * ----------------------------------------------------------
   * SHOPPING
   * ----------------------------------------------------------
   */

  if (
    category.includes("shops") ||
    category.includes("shopping") ||
    category.includes("retail")
  ) {
    return "shopping";
  }

  /*
   * ----------------------------------------------------------
   * ENTERTAINMENT
   * ----------------------------------------------------------
   */

  if (
    category.includes("entertainment") ||
    category.includes("arts") ||
    category.includes("recreation") ||
    category.includes("sporting")
  ) {
    return "events";
  }

  /*
   * ----------------------------------------------------------
   * TRAVEL
   * ----------------------------------------------------------
   */

  if (
    category.includes("airline") ||
    category.includes("airlines")
  ) {
    return "airfare";
  }

  if (
    category.includes("lodging") ||
    category.includes("hotel")
  ) {
    return "accommodations";
  }

  /*
   * ----------------------------------------------------------
   * CLEANING
   * ----------------------------------------------------------
   */

  if (
    text.includes("laundry") ||
    text.includes("automatic laundry")
  ) {
    return "cleaning";
  }

  /*
   * ----------------------------------------------------------
   * SUBSCRIPTIONS
   * ----------------------------------------------------------
   */

  if (
    text.includes("netflix") ||
    text.includes("spotify") ||
    text.includes("hulu") ||
    text.includes("youtube premium") ||
    text.includes("amazon prime") ||
    text.includes("subscription")
  ) {
    return "subscriptions";
  }

  /*
   * ----------------------------------------------------------
   * HOME
   * ----------------------------------------------------------
   */

  if (
    category.includes("rent") ||
    category.includes("mortgage")
  ) {
    return "housing";
  }

  if (
    category.includes("electric")
  ) {
    return "electricity";
  }

  if (
    category.includes("internet") ||
    text.includes("verizon") ||
    text.includes("comcast") ||
    text.includes("xfinity") ||
    text.includes("spectrum")
  ) {
    return "internet";
  }

  /*
   * ----------------------------------------------------------
   * DEFAULT PLAID PURCHASE MAPPING
   * ----------------------------------------------------------
   */

  if (
    category.includes("shops") ||
    category.includes("shopping")
  ) {
    return "shopping";
  }

  /*
   * ----------------------------------------------------------
   * UNKNOWN
   * ----------------------------------------------------------
   */

  return "other";
}

/*
 * ============================================================
 * ACCOUNT SUMMARY
 * ============================================================
 */

export function summarizeAccounts(
  accounts: any[]
): AccountSummary {
  const totals = {
    cash: { amount: 0, unknown: false },
    investments: { amount: 0, unknown: false },
    crypto: { amount: 0, unknown: false },
    credit: { amount: 0, unknown: false },
  };

  for (const account of accounts ?? []) {
    const rawBalance = account?.current_balance;
    const parsedBalance = rawBalance == null || rawBalance === "" ? null : Number(rawBalance);
    const balance = parsedBalance != null && Number.isFinite(parsedBalance) ? parsedBalance : null;

    const accountType =
      normalize(
        account?.account_type
      );

    const subtype =
      normalize(
        account?.account_subtype
      );

    const isCredit =
      accountType === "credit" ||
      subtype.includes("credit");

    const isCrypto =
      accountType === "crypto" ||
      subtype.includes("crypto");

    const isInvestment =
      accountType === "investment" ||
      subtype.includes("brokerage") ||
      subtype.includes("investment") ||
      subtype.includes("roth") ||
      subtype.includes("ira") ||
      subtype.includes("401") ||
      subtype.includes("retirement") ||
      subtype.includes("pension");

    const bucket = isCredit ? totals.credit
      : isCrypto ? totals.crypto
        : isInvestment ? totals.investments
          : accountType === "depository" ? totals.cash
            : null;
    if (!bucket) continue;
    if (balance == null) bucket.unknown = true;
    else bucket.amount += balance;
  }

  const cash = totals.cash.unknown ? null : totals.cash.amount;
  const investments = totals.investments.unknown ? null : totals.investments.amount;
  const crypto = totals.crypto.unknown ? null : totals.crypto.amount;
  const credit = totals.credit.unknown ? null : totals.credit.amount;
  const netWorth = [cash, investments, crypto, credit].some((value) => value == null)
    ? null
    // Credit account balances represent amounts owed: display the bucket as a
    // positive debt amount, but subtract it from net worth.
    : cash! + investments! + crypto! - credit!;

  return {
    cash,
    investments,
    crypto,
    credit,
    netWorth,
  };
}

/*
 * ============================================================
 * MONTHLY ACCOUNTING
 * ============================================================
 */

export function computeMonthlyAccounting(
  transactions: any[],
  _accounts?: any[]
): MonthlyAccounting {
  let income = 0;
  let grossSpending = 0;
  let spending = 0;
  let transfers = 0;
  let creditCardPayments = 0;
  let refunds = 0;
  let investmentActivity = 0;
  let pendingSpending = 0;

  const spendingMap =
    new Map<string, number>();

  for (const tx of transactions ?? []) {
    const amount =
      toNumber(tx?.amount);

    if (amount === 0) {
      continue;
    }

    /*
     * --------------------------------------------------------
     * VENMO DINING REIMBURSEMENTS
     * --------------------------------------------------------
     *
     * Posted incoming Venmo payments under $100 reduce the
     * current month's Dining Out total and net spending. Other
     * Venmo activity remains excluded by the transfer logic.
     */

    if (isIncomingVenmoDiningReimbursement(tx)) {
      const reimbursement = Math.abs(amount);

      spending -= reimbursement;
      spendingMap.set(
        "dining_out",
        (spendingMap.get("dining_out") ?? 0) - reimbursement
      );
      continue;
    }

    /*
     * --------------------------------------------------------
     * INCOME
     * --------------------------------------------------------
     */

    if (isIncome(tx)) {
      income += Math.abs(amount);
      continue;
    }

    /*
     * --------------------------------------------------------
     * CREDIT CARD PAYMENTS
     * --------------------------------------------------------
     */

    if (isCreditCardPayment(tx)) {
      creditCardPayments += Math.abs(amount);
      continue;
    }

    /*
     * --------------------------------------------------------
     * INVESTMENTS
     * --------------------------------------------------------
     */

    if (isInvestment(tx)) {
      investmentActivity +=
        Math.abs(amount);

      continue;
    }

    /*
     * --------------------------------------------------------
     * REFUNDS
     * --------------------------------------------------------
     */

    if (isRefund(tx)) {
      refunds += Math.abs(amount);
      continue;
    }

    /*
     * --------------------------------------------------------
     * TRANSFERS
     * --------------------------------------------------------
     */

    if (isTransfer(tx)) {
      transfers += Math.abs(amount);
      continue;
    }

    /*
     * --------------------------------------------------------
     * ARBITRAGE
     * --------------------------------------------------------
     *
     * Excluded from normal spending.
     */

    if (isArbitrage(tx)) {
      continue;
    }

    /*
     * --------------------------------------------------------
     * NORMAL SPENDING
     * --------------------------------------------------------
     */

    const actual =
      getSpendingAmount(tx);

    if (actual <= 0) {
      continue;
    }

    grossSpending += actual;
    spending += actual;

    if (tx?.pending) {
      pendingSpending += actual;
    }

    const budgetCategory =
      getBudgetCategory(tx);

    if (!budgetCategory) {
      continue;
    }

    const current =
      spendingMap.get(
        budgetCategory
      ) ?? 0;

    spendingMap.set(
      budgetCategory,
      current + actual
    );
  }

  const spendingByCategory =
    Array.from(
      spendingMap.entries()
    )
      .map(
        ([category, total]) => ({
          category,
          total,
        })
      )
      .sort(
        (a, b) =>
          b.total - a.total
      );

  return {
    income,
    grossSpending,
    spending,
    transfers,
    creditCardPayments,
    refunds,
    investmentActivity,
    pendingSpending,
    spendingByCategory,
  };
}

/*
 * ============================================================
 * BUDGET HELPERS
 * ============================================================
 */

export function getActualForBudgetCategory(
  spendingByCategory: SpendingCategoryTotal[],
  category: string
): number {
  const match =
    spendingByCategory.find(
      (item) =>
        item.category === category
    );

  return match?.total ?? 0;
}

/*
 * The accounting engine deliberately keeps detailed Plaid-compatible buckets.
 * The dashboard presents those same live totals in five broad categories.
 */
export function getDashboardBudgetTotals(
  spendingByCategory: SpendingCategoryTotal[]
): DashboardBudgetCategoryTotal[] {
  const sourceTotals = new Map(
    spendingByCategory.map((item) => [item.category, item.total])
  );
  const totalFor = (categories: string[]) =>
    categories.reduce(
      (total, category) => total + (sourceTotals.get(category) ?? 0),
      0
    );

  return [
    {
      label: "Housing & Bills",
      total: totalFor(["housing", "electricity", "internet", "cleaning", "subscriptions"]),
    },
    {
      label: "Food",
      total: totalFor(["groceries", "dining_out"]),
    },
    {
      label: "Transportation",
      total: totalFor(["uber", "public_transportation", "fuel", "airfare"]),
    },
    {
      label: "Shopping & Personal",
      total: totalFor(["shopping", "events", "accommodations", "other"]),
    },
    {
      label: "Health",
      total: totalFor(["medicine", "doctors_dentist", "gym"]),
    },
  ];
}

export function getBudgetRemaining(
  budgetAmount: number,
  actualAmount: number
): number {
  return (
    budgetAmount -
    actualAmount
  );
}

export function getBudgetUsagePercent(
  budgetAmount: number,
  actualAmount: number
): number {
  if (budgetAmount <= 0) {
    return actualAmount > 0
      ? 100
      : 0;
  }

  return (
    (actualAmount /
      budgetAmount) *
    100
  );
}

/*
 * ============================================================
 * DEFAULT EXPORT
 * ============================================================
 */

const accounting = {
  summarizeAccounts,
  computeMonthlyAccounting,
  getActualForBudgetCategory,
  getDashboardBudgetTotals,
  getBudgetRemaining,
  getBudgetUsagePercent,
};

export default accounting;
