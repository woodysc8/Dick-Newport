import { createClient } from "@supabase/supabase-js";
import { Configuration, PlaidApi } from "plaid";
import { calculateSecuritiesOnlyValue } from "./investmentSnapshots";

const FIXED_USER_ID = "4ac12929-b795-474e-9001-56190c6c4daf";

const configuration = new Configuration({
  basePath: process.env.PLAID_ENV === "production"
    ? "https://production.plaid.com"
    : "https://sandbox.plaid.com",
  baseOptions: {
    headers: {
      "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
      "PLAID-SECRET": process.env.PLAID_SECRET!,
    },
  },
});

const plaidClient = new PlaidApi(configuration);
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type StoredItem = {
  plaid_item_id: string;
  access_token: string;
  institution_name: string | null;
  transactions_cursor: string | null;
};

export type ItemRefreshResult = {
  institution: string;
  plaid_item_id: string;
  accounts_updated: number;
  accounts_created: number;
  transactions_added: number;
  transactions_modified: number;
  transactions_removed: number;
  holdings_updated: number;
  holdings_removed: number;
  status: "success" | "error";
  errors: string[];
  warnings: string[];
};

export type FinancialSyncResult = {
  success: boolean;
  status: "completed" | "in_progress";
  items: ItemRefreshResult[];
};

const SYNC_LEASE_MS = 15 * 60 * 1000;
let localRefresh: Promise<FinancialSyncResult> | null = null;

function formattedPlaidError(operation: string, error: unknown): string {
  const candidate = (error !== null && typeof error === "object" ? error : {}) as {
    message?: unknown;
    status?: unknown;
    response?: {
      status?: unknown;
      data?: {
        error_code?: unknown;
        error_type?: unknown;
        error_message?: unknown;
      };
    };
  };
  const responseData = candidate.response?.data;
  const status = typeof candidate.response?.status === "number"
    ? candidate.response.status
    : typeof candidate.status === "number"
      ? candidate.status
      : null;
  const details = [
    typeof responseData?.error_code === "string" ? responseData.error_code : null,
    typeof responseData?.error_type === "string" ? responseData.error_type : null,
    typeof responseData?.error_message === "string" ? responseData.error_message : null,
  ].filter((detail): detail is string => detail != null);
  const fallback = typeof candidate.message === "string"
    ? candidate.message
    : typeof error === "string"
      ? error
      : "Plaid request failed";

  return `${operation} failed${status == null ? "" : ` (${status})`}: ${details.length > 0 ? details.join(" - ") : fallback}`;
}

function investmentsUnavailable(error: unknown) {
  const code = (error as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
  return code === "PRODUCT_NOT_SUPPORTED" || code === "PRODUCT_NOT_READY" || code === "INVALID_PRODUCT";
}

function isInvestmentAccount(account: { type?: string | null; subtype?: string | null }) {
  const type = (account.type ?? "").toLowerCase();
  const subtype = (account.subtype ?? "").toLowerCase();
  return type === "investment" || subtype.includes("brokerage") || subtype.includes("investment");
}

function isRobinhoodItem(item: StoredItem) {
  return (item.institution_name ?? "").toLowerCase().includes("robinhood");
}

function localSnapshotDate() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

async function persistDailyInvestmentSnapshot(
  item: StoredItem,
  plaidAccountId: string,
  portfolioValue: number | null,
  securitiesValue: number
) {
  const { error } = await supabase.from("investment_snapshots").upsert(
    {
      user_id: FIXED_USER_ID,
      plaid_item_id: item.plaid_item_id,
      plaid_account_id: plaidAccountId,
      snapshot_date: localSnapshotDate(),
      portfolio_value: portfolioValue,
      securities_value: securitiesValue,
    },
    { onConflict: "user_id,plaid_account_id,snapshot_date" }
  );
  if (error) throw new Error(`Investment snapshot persistence failed: ${error.message}`);
}

async function refreshAccounts(item: StoredItem, result: ItemRefreshResult) {
  let response;
  try {
    response = await plaidClient.accountsGet({ access_token: item.access_token });
  } catch (error) {
    throw new Error(formattedPlaidError("accountsGet", error));
  }
  for (const account of response.data.accounts ?? []) {
    const { data: existing, error: lookupError } = await supabase
      .from("accounts")
      .select("id")
      .eq("user_id", FIXED_USER_ID)
      .eq("plaid_account_id", account.account_id)
      .maybeSingle();
    if (lookupError) throw new Error(`Account lookup failed: ${lookupError.message}`);

    const accountData = {
      user_id: FIXED_USER_ID,
      plaid_item_id: item.plaid_item_id,
      institution_name: item.institution_name ?? "Unknown Institution",
      account_name: account.name ?? account.official_name ?? "",
      account_type: account.type ?? null,
      account_subtype: account.subtype ?? null,
      mask: account.mask ?? null,
      current_balance: account.balances.current ?? null,
      available_balance: account.balances.available ?? null,
      currency: account.balances.iso_currency_code ?? account.balances.unofficial_currency_code ?? "USD",
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await supabase.from("accounts").update(accountData).eq("id", existing.id);
      if (error) throw new Error(`Account update failed: ${error.message}`);
      result.accounts_updated += 1;
    } else {
      const { error } = await supabase.from("accounts").insert({ ...accountData, plaid_account_id: account.account_id });
      if (error) throw new Error(`Account insert failed: ${error.message}`);
      result.accounts_created += 1;
    }
  }
}

async function localAccountId(plaidAccountId: string | null | undefined) {
  if (!plaidAccountId) return null;
  const { data, error } = await supabase
    .from("accounts")
    .select("id")
    .eq("user_id", FIXED_USER_ID)
    .eq("plaid_account_id", plaidAccountId)
    .maybeSingle();
  if (error) throw new Error(`Transaction account lookup failed: ${error.message}`);
  return data?.id ?? null;
}

type PlaidTransaction = {
  account_id?: string | null;
  transaction_id: string;
  date: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  category?: string[] | string | null;
  pending?: boolean;
};

async function persistTransaction(transaction: PlaidTransaction, result: ItemRefreshResult, mode: "added" | "modified") {
  const accountId = await localAccountId(transaction.account_id);
  const payload = {
    user_id: FIXED_USER_ID,
    account_id: accountId,
    plaid_transaction_id: transaction.transaction_id,
    date: transaction.date,
    name: transaction.name,
    merchant_name: transaction.merchant_name ?? null,
    amount: transaction.amount,
    category: Array.isArray(transaction.category) ? transaction.category.join(" > ") : transaction.category ?? null,
    pending: Boolean(transaction.pending),
    updated_at: new Date().toISOString(),
  };
  const { data: existing, error: lookupError } = await supabase
    .from("transactions")
    .select("id")
    .eq("user_id", FIXED_USER_ID)
    .eq("plaid_transaction_id", transaction.transaction_id)
    .maybeSingle();
  if (lookupError) throw new Error(`Transaction lookup failed: ${lookupError.message}`);

  if (existing) {
    const { error } = await supabase.from("transactions").update(payload).eq("id", existing.id);
    if (error) throw new Error(`Transaction update failed: ${error.message}`);
    result.transactions_modified += 1;
  } else {
    const { error } = await supabase.from("transactions").insert(payload);
    if (error) throw new Error(`Transaction insert failed: ${error.message}`);
    if (mode === "modified") result.transactions_modified += 1;
    else result.transactions_added += 1;
  }
}

async function refreshTransactions(item: StoredItem, result: ItemRefreshResult) {
  // Plaid specifies an empty cursor only for the first sync.  Advance the
  // stored cursor after every completely persisted page, so a retry can safely
  // replay a page if persistence fails rather than skip transactions.
  let cursor = item.transactions_cursor ?? "";
  let hasMore = true;
  while (hasMore) {
    let response;
    try {
      response = await plaidClient.transactionsSync({ access_token: item.access_token, cursor });
    } catch (error) {
      throw new Error(formattedPlaidError("transactionsSync", error));
    }
    for (const transaction of response.data.added ?? []) await persistTransaction(transaction, result, "added");
    for (const transaction of response.data.modified ?? []) await persistTransaction(transaction, result, "modified");
    for (const removed of response.data.removed ?? []) {
      const transactionId = removed.transaction_id;
      if (!transactionId) continue;
      const { data: deleted, error } = await supabase
        .from("transactions")
        .delete()
        .eq("user_id", FIXED_USER_ID)
        .eq("plaid_transaction_id", transactionId)
        .select("id");
      if (error) throw new Error(`Transaction delete failed: ${error.message}`);
      result.transactions_removed += deleted?.length ?? 0;
    }
    const nextCursor = response.data.next_cursor;
    const { error: cursorError } = await supabase
      .from("plaid_items")
      .update({ transactions_cursor: nextCursor, updated_at: new Date().toISOString() })
      .eq("user_id", FIXED_USER_ID)
      .eq("plaid_item_id", item.plaid_item_id);
    if (cursorError) throw new Error(`Transaction cursor persistence failed: ${cursorError.message}`);
    cursor = nextCursor;
    hasMore = response.data.has_more;
  }
}

async function refreshHoldings(item: StoredItem, result: ItemRefreshResult) {
  const { data: itemAccounts, error: itemAccountsError } = await supabase
    .from("accounts")
    .select("plaid_account_id, account_type, account_subtype, current_balance")
    .eq("user_id", FIXED_USER_ID)
    .eq("plaid_item_id", item.plaid_item_id);
  if (itemAccountsError) throw new Error(`Investment account lookup failed: ${itemAccountsError.message}`);

  // Products.Investments is only requested for Items that actually contain an
  // investment account. Ordinary banking and credit Items should not be asked
  // for an Investments product they were never consented for.
  if (!(itemAccounts ?? []).some((account) => isInvestmentAccount({
    type: account.account_type,
    subtype: account.account_subtype,
  }))) return;

  let response;
  try {
    response = await plaidClient.investmentsHoldingsGet({ access_token: item.access_token });
  } catch (error) {
    if (investmentsUnavailable(error)) {
      result.warnings.push("Investments are not available for this Item.");
      return;
    }
    throw new Error(formattedPlaidError("investmentsHoldingsGet", error));
  }

  const securities = new Map((response.data.securities ?? []).map((security) => [security.security_id, security]));
  const currentKeys = new Set<string>();
  const securitiesByAccount = new Map<string, Array<{ tickerSymbol?: string | null; securityName?: string | null; currency?: string | null; value: number | string | null }>>();
  for (const holding of response.data.holdings ?? []) {
    if (!holding.account_id || !holding.security_id) continue;
    const security = securities.get(holding.security_id);
    const key = `${holding.account_id}:${holding.security_id}`;
    currentKeys.add(key);
    const accountAssets = securitiesByAccount.get(holding.account_id) ?? [];
    accountAssets.push({
      tickerSymbol: security?.ticker_symbol ?? null,
      securityName: security?.name ?? null,
      currency: security?.iso_currency_code ?? holding.iso_currency_code ?? null,
      value: holding.institution_value ?? null,
    });
    securitiesByAccount.set(holding.account_id, accountAssets);
    const { data: existing, error: lookupError } = await supabase
      .from("investment_holdings")
      .select("id")
      .eq("user_id", FIXED_USER_ID)
      .eq("plaid_account_id", holding.account_id)
      .eq("security_id", holding.security_id)
      .maybeSingle();
    if (lookupError) throw new Error(`Holding lookup failed: ${lookupError.message}`);
    const currency = security?.iso_currency_code ?? holding.iso_currency_code ?? "USD";
    const holdingData = {
      user_id: FIXED_USER_ID,
      plaid_item_id: item.plaid_item_id,
      plaid_account_id: holding.account_id,
      security_id: holding.security_id,
      ticker_symbol: security?.ticker_symbol ?? null,
      security_name: security?.name ?? null,
      quantity: holding.quantity ?? null,
      institution_price: holding.institution_price ?? null,
      institution_value: holding.institution_value ?? null,
      cost_basis: holding.cost_basis ?? null,
      currency,
      iso_currency_code: currency,
      updated_at: new Date().toISOString(),
    };
    const { error } = existing
      ? await supabase.from("investment_holdings").update(holdingData).eq("id", existing.id)
      : await supabase.from("investment_holdings").insert(holdingData);
    if (error) throw new Error(`Holding persistence failed: ${error.message}`);
    result.holdings_updated += 1;
  }

  const { data: storedHoldings, error: storedError } = await supabase
    .from("investment_holdings")
    .select("id, plaid_account_id, security_id")
    .eq("user_id", FIXED_USER_ID)
    .eq("plaid_item_id", item.plaid_item_id);
  if (storedError) throw new Error(`Stored holdings lookup failed: ${storedError.message}`);
  for (const storedHolding of storedHoldings ?? []) {
    if (currentKeys.has(`${storedHolding.plaid_account_id}:${storedHolding.security_id}`)) continue;
    const { error } = await supabase.from("investment_holdings").delete().eq("id", storedHolding.id);
    if (error) throw new Error(`Stale holding removal failed: ${error.message}`);
    result.holdings_removed += 1;
  }

  if (isRobinhoodItem(item)) {
    for (const account of itemAccounts ?? []) {
      if (!account.plaid_account_id || !isInvestmentAccount({ type: account.account_type, subtype: account.account_subtype })) continue;
      await persistDailyInvestmentSnapshot(
        item,
        account.plaid_account_id,
        typeof account.current_balance === "number" && Number.isFinite(account.current_balance) ? account.current_balance : null,
        calculateSecuritiesOnlyValue(securitiesByAccount.get(account.plaid_account_id) ?? [])
      );
    }
  }
}

async function refreshItem(item: StoredItem): Promise<ItemRefreshResult> {
  const result: ItemRefreshResult = {
    institution: item.institution_name ?? "Unknown Institution",
    plaid_item_id: item.plaid_item_id,
    accounts_updated: 0,
    accounts_created: 0,
    transactions_added: 0,
    transactions_modified: 0,
    transactions_removed: 0,
    holdings_updated: 0,
    holdings_removed: 0,
    status: "success",
    errors: [],
    warnings: [],
  };
  for (const step of [refreshAccounts, refreshTransactions, refreshHoldings]) {
    try {
      await step(item, result);
    } catch (error) {
      result.status = "error";
      const message = error instanceof Error ? error.message : "Refresh step failed";
      result.errors.push(message);
      console.error(`Plaid refresh failed for item ${item.plaid_item_id}:`, message);
    }
  }
  return result;
}

async function acquireFinancialSyncLease() {
  const token = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - SYNC_LEASE_MS).toISOString();
  const { data, error } = await supabase
    .from("profiles")
    .update({ plaid_sync_lock_token: token, plaid_sync_locked_at: new Date().toISOString() })
    .eq("id", FIXED_USER_ID)
    .or(`plaid_sync_lock_token.is.null,plaid_sync_locked_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Financial sync lock acquisition failed: ${error.message}`);
  return data ? token : null;
}

async function releaseFinancialSyncLease(token: string) {
  const { error } = await supabase
    .from("profiles")
    .update({ plaid_sync_lock_token: null, plaid_sync_locked_at: null })
    .eq("id", FIXED_USER_ID)
    .eq("plaid_sync_lock_token", token);
  if (error) console.error("Financial sync lock release failed:", error.message);
}

async function runFinancialDataRefresh(): Promise<FinancialSyncResult> {
  const token = await acquireFinancialSyncLease();
  if (!token) return { success: true, status: "in_progress", items: [] };
  try {
  const { data, error } = await supabase
    .from("plaid_items")
    .select("plaid_item_id, access_token, institution_name, transactions_cursor")
    .eq("user_id", FIXED_USER_ID);
  if (error) throw new Error(`Plaid Item lookup failed: ${error.message}`);
  const items = (data ?? []) as StoredItem[];
  const results = await Promise.all(items.map(refreshItem));
  return { success: results.every((item) => item.status === "success"), status: "completed", items: results };
  } finally {
    await releaseFinancialSyncLease(token);
  }
}

// The shared background-sync entry point.  Duplicate in-process callers join
// the same work; the database lease also protects separate server instances.
export function refreshFinancialData(): Promise<FinancialSyncResult> {
  if (localRefresh) return localRefresh;
  localRefresh = runFinancialDataRefresh().finally(() => {
    localRefresh = null;
  });
  return localRefresh;
}
