import type { PlaidApi } from "plaid";
import { decryptPlaidSecret } from "./plaidEncryption";
import { isAuthenticatedPlaidContext, type PlaidUserContext } from "./plaidTenant";
import { classifyTransaction } from "./transactionClassification";
import { collectTransactionSync } from "./transactionSyncBatch";

const plaidRefreshContextBrand = Symbol("PlaidRefreshContext");

export type PlaidRefreshContext = {
  userId: PlaidUserContext["userId"];
  supabase: PlaidUserContext["supabase"];
  plaidClient: PlaidApi;
  credentialId: string;
  readonly [plaidRefreshContextBrand]: true;
};

export function createPlaidRefreshContext(
  authenticatedContext: PlaidUserContext,
  plaidClient: PlaidApi,
  credentialId: string,
): PlaidRefreshContext {
  if (!isAuthenticatedPlaidContext(authenticatedContext)) {
    throw new Error("Financial refresh requires a verified authenticated context");
  }
  return {
    userId: authenticatedContext.userId,
    supabase: authenticatedContext.supabase,
    plaidClient,
    credentialId,
    [plaidRefreshContextBrand]: true,
  };
}

type StoredItem = {
  credential_id: string;
  connection_status: string;
  products: string[];
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
  failed_stages?: Array<"ownership" | "token_decryption" | "accounts" | "transactions" | "investments">;
};

export type FinancialSyncResult = {
  success: boolean;
  status: "completed" | "in_progress";
  items: ItemRefreshResult[];
};

const SYNC_LEASE_MS = 15 * 60 * 1000;
const localRefreshes = new Map<string, Promise<FinancialSyncResult>>();

function formattedPlaidError(operation: string, error: unknown): string {
  void error;
  return `${operation} failed. Check connection and product access.`;
}


function isUniqueViolation(error: { code?: string } | null) {
  return error?.code === "23505";
}


async function refreshAccounts(context: PlaidRefreshContext, item: StoredItem, result: ItemRefreshResult) {
  let response;
  try {
    response = await context.plaidClient.accountsGet({ access_token: item.access_token });
  } catch (error) {
    throw new Error(formattedPlaidError("accountsGet", error));
  }

  for (const account of response.data.accounts ?? []) {
    if (!account.account_id) continue;
    const accountData = {
      user_id: context.userId,
      plaid_item_id: item.plaid_item_id,
      plaid_account_id: account.account_id,
      ...(account.persistent_account_id ? { persistent_account_id: account.persistent_account_id } : {}),
      institution_name: item.institution_name ?? "Unknown Institution",
      account_name: account.name ?? account.official_name ?? "",
      account_type: account.type ?? null,
      account_subtype: account.subtype ?? null,
      mask: account.mask ?? null,
      current_balance: account.balances.current ?? null,
      available_balance: account.balances.available ?? null,
      currency: account.balances.iso_currency_code ?? account.balances.unofficial_currency_code ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data: existing, error: lookupError } = await context.supabase
      .from("accounts")
      .select("id")
      .eq("user_id", context.userId)
      .eq("plaid_item_id", item.plaid_item_id)
      .eq("plaid_account_id", account.account_id)
      .maybeSingle();
    if (lookupError) throw new Error(`Account lookup failed: request failed`);

    if (existing) {
      const { error } = await context.supabase.from("accounts").update(accountData).eq("id", existing.id).eq("user_id", context.userId);
      if (error) throw new Error(`Account update failed: request failed`);
      result.accounts_updated += 1;
      continue;
    }

    const { error: insertError } = await context.supabase.from("accounts").insert(accountData);
    if (!insertError) {
      result.accounts_created += 1;
      continue;
    }
    if (!isUniqueViolation(insertError)) throw new Error(`Account insert failed: request failed`);

    const { data: raced, error: racedLookupError } = await context.supabase
      .from("accounts")
      .select("id")
      .eq("user_id", context.userId)
      .eq("plaid_item_id", item.plaid_item_id)
      .eq("plaid_account_id", account.account_id)
      .maybeSingle();
    if (racedLookupError || !raced) throw new Error(`Account conflict recovery failed: account not found`);
    const { error: recoveryError } = await context.supabase
    .from("accounts")
    .update(accountData)
    .eq("id", raced.id)
    .eq("user_id", context.userId)
    .eq("plaid_item_id", item.plaid_item_id)
    .eq("plaid_account_id", account.account_id);
    if (recoveryError) throw new Error(`Account conflict recovery failed: request failed`);
    result.accounts_updated += 1;
  }
}

async function localAccountId(context: PlaidRefreshContext, item: StoredItem, plaidAccountId: string | null | undefined) {
  if (!plaidAccountId) return null;
  const { data, error } = await context.supabase
    .from("accounts")
    .select("id")
    .eq("user_id", context.userId)
    .eq("plaid_item_id", item.plaid_item_id)
    .eq("plaid_account_id", plaidAccountId)
    .maybeSingle();
  if (error) throw new Error(`Transaction account lookup failed: request failed`);
  return data?.id ?? null;
}

type PlaidTransaction = {
  account_id?: string | null;
  transaction_id: string;
  pending_transaction_id?: string | null;
  date: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  category?: string[] | string | null;
  pending?: boolean;
  iso_currency_code?: string | null;
  unofficial_currency_code?: string | null;
  personal_finance_category?: { primary: string; detailed: string; confidence_level?: string | null } | null;
};

async function removeLinkedPendingTransaction(
  context: PlaidRefreshContext,
  accountId: string | null,
  pendingTransactionId: string | null | undefined,
) {
  if (!pendingTransactionId) return 0;
  if (!accountId) throw new Error("Cannot safely reconcile a pending transaction without its linked account");

  const { data, error } = await context.supabase
    .from("transactions")
    .delete()
    .eq("user_id", context.userId)
    .eq("account_id", accountId)
    .eq("plaid_transaction_id", pendingTransactionId)
    .eq("pending", true)
    .select("id");
  if (error) throw new Error(`Pending transaction reconciliation failed: request failed`);
  return data?.length ?? 0;
}

async function persistTransaction(
  context: PlaidRefreshContext,
  item: StoredItem,
  transaction: PlaidTransaction,
  result: ItemRefreshResult,
  mode: "added" | "modified",
) {
  if (!transaction.transaction_id) throw new Error("Plaid transaction is missing its identity");
  const accountId = await localAccountId(context, item, transaction.account_id);
  if (transaction.account_id && !accountId) throw new Error("Transaction account has not been imported safely");
  const reconcile = async () => {
    if (!transaction.pending) result.transactions_removed += await removeLinkedPendingTransaction(context, accountId, transaction.pending_transaction_id);
  };
  const payload = {
    user_id: context.userId,
    account_id: accountId,
    plaid_transaction_id: transaction.transaction_id,
    date: transaction.date,
    name: transaction.name,
    merchant_name: transaction.merchant_name ?? null,
    amount: transaction.amount,
    ...(transaction.category !== undefined ? { category: Array.isArray(transaction.category) ? transaction.category.join(" > ") : transaction.category } : {}),
    pending: Boolean(transaction.pending),
    pending_transaction_id: transaction.pending_transaction_id ?? null,
    transaction_currency: transaction.iso_currency_code ?? transaction.unofficial_currency_code ?? null,
    plaid_primary_category: transaction.personal_finance_category?.primary ?? null,
    plaid_detailed_category: transaction.personal_finance_category?.detailed ?? null,
    plaid_category_confidence: transaction.personal_finance_category?.confidence_level ?? null,
    normalized_category: classifyTransaction({ category_override: null, plaid_primary_category: transaction.personal_finance_category?.primary ?? null, plaid_detailed_category: transaction.personal_finance_category?.detailed ?? null, plaid_category_confidence: transaction.personal_finance_category?.confidence_level ?? null, merchant_name: transaction.merchant_name ?? null, name: transaction.name }).category,
    updated_at: new Date().toISOString(),
  };
  const { data: existing, error: lookupError } = await context.supabase
    .from("transactions")
    .select("id, account_id")
    .eq("user_id", context.userId)
    .eq("plaid_transaction_id", transaction.transaction_id)
    .maybeSingle();
  if (lookupError) throw new Error(`Transaction lookup failed: request failed`);

  if (existing) {
    if (existing.account_id && accountId && existing.account_id !== accountId) {
      const { data: sameItem, error } = await context.supabase.from("accounts").select("id")
        .eq("id", existing.account_id).eq("user_id", context.userId).eq("plaid_item_id", item.plaid_item_id).maybeSingle();
      if (error) throw new Error("Transaction source ownership check failed");
      if (!sameItem) { result.warnings.push("A repeated transaction identity from another connection was retained at its original source."); return; }
    }
    const { error } = await context.supabase.from("transactions").update(payload).eq("id", existing.id).eq("user_id", context.userId);
    if (error) throw new Error(`Transaction update failed: request failed`);
    result.transactions_modified += 1;
    await reconcile();
    return;
  }

  const { error: insertError } = await context.supabase.from("transactions").insert(payload);
  if (!insertError) {
    if (mode === "modified") result.transactions_modified += 1;
    else result.transactions_added += 1;
    await reconcile();
    return;
  }
  if (!isUniqueViolation(insertError)) throw new Error(`Transaction insert failed: request failed`);

  const { data: raced, error: racedLookupError } = await context.supabase
    .from("transactions")
    .select("id, account_id")
    .eq("user_id", context.userId)
    .eq("plaid_transaction_id", transaction.transaction_id)
    .maybeSingle();
  if (racedLookupError || !raced) throw new Error(`Transaction conflict recovery failed: transaction not found`);
  if (raced.account_id && accountId && raced.account_id !== accountId) {
    const { data: sameItem, error } = await context.supabase.from("accounts").select("id")
      .eq("id", raced.account_id).eq("user_id", context.userId).eq("plaid_item_id", item.plaid_item_id).maybeSingle();
    if (error) throw new Error("Transaction source conflict check failed");
    if (!sameItem) { result.warnings.push("A repeated transaction identity from another connection was retained at its original source."); return; }
  }
  const { error: recoveryError } = await context.supabase
    .from("transactions")
    .update(payload)
    .eq("id", raced.id)
    .eq("user_id", context.userId)
    .eq("plaid_transaction_id", transaction.transaction_id);
  if (recoveryError) throw new Error(`Transaction conflict recovery failed: request failed`);
  result.transactions_modified += 1;
  await reconcile();
}

async function refreshTransactions(context: PlaidRefreshContext, item: StoredItem, result: ItemRefreshResult) {
  const batch = await collectTransactionSync(context.plaidClient, item.access_token, item.transactions_cursor ?? "");
  for (const transaction of batch.added) await persistTransaction(context, item, transaction, result, "added");
  for (const transaction of batch.modified) await persistTransaction(context, item, transaction, result, "modified");
  for (const removed of batch.removed) {
    if (!removed.transaction_id) continue;
    const { data: stored, error: storedError } = await context.supabase.from("transactions")
      .select("id, account_id").eq("user_id", context.userId).eq("plaid_transaction_id", removed.transaction_id).maybeSingle();
    if (storedError) throw new Error("Removed transaction lookup failed");
    if (!stored) continue;
    if (!stored.account_id) throw new Error("Removed transaction account cannot be verified");
    const { data: ownerAccount, error: ownerError } = await context.supabase.from("accounts")
      .select("id").eq("user_id", context.userId).eq("id", stored.account_id).eq("plaid_item_id", item.plaid_item_id).maybeSingle();
    if (ownerError) throw new Error("Removed transaction ownership check failed");
    if (!ownerAccount) continue;
    const { data: deleted, error } = await context.supabase
      .from("transactions")
      .delete()
      .eq("user_id", context.userId)
      .eq("plaid_transaction_id", removed.transaction_id)
      .eq("account_id", stored.account_id)
      .select("id");
    if (error) throw new Error(`Transaction delete failed: request failed`);
    result.transactions_removed += deleted?.length ?? 0;
  }
  const nextCursor = batch.cursor;
  const { error: cursorError } = await context.supabase
    .from("plaid_items")
    .update({ transactions_cursor: nextCursor, updated_at: new Date().toISOString() })
    .eq("user_id", context.userId)
    .eq("plaid_item_id", item.plaid_item_id);
  if (cursorError) throw new Error(`Transaction cursor persistence failed: request failed`);
}


async function refreshItem(context: PlaidRefreshContext, item: StoredItem): Promise<ItemRefreshResult> {
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
  if (!context.credentialId || item.credential_id !== context.credentialId || item.connection_status !== "active") {
    result.status = "error";
    result.errors.push("Connection needs reconnection with personal credentials.");
    result.failed_stages = ["ownership"];
    return result;
  }
  try {
    item = { ...item, access_token: decryptPlaidSecret(item.access_token, `item:${context.userId}:${item.credential_id}:${item.plaid_item_id}`) };
  } catch {
    result.status = "error";
    result.errors.push("Unable to unlock this connection. Check server encryption configuration.");
    result.failed_stages = ["token_decryption"];
    return result;
  }
  const steps = [refreshAccounts];
  if (item.products.includes("transactions")) steps.push(refreshTransactions);
  result.warnings.push("Holdings sync is separate. Use Sync holdings on the Investments page.");
  for (const step of steps) {
    try {
      await step(context, item, result);
    } catch (error) {
      result.status = "error";
      void error;
      result.errors.push("Refresh step failed. Check connection and product access.");
      const stage = step === refreshAccounts ? "accounts" : "transactions";
      (result.failed_stages ??= []).push(stage);
      console.warn("Plaid sync step failed", { stage, category: "sync_step_failed" });
    }
  }
  return result;
}

async function acquireFinancialSyncLease(context: PlaidRefreshContext) {
  const token = crypto.randomUUID();
  const staleBefore = new Date(Date.now() - SYNC_LEASE_MS).toISOString();
  const { data, error } = await context.supabase
    .from("profiles")
    .update({ plaid_sync_lock_token: token, plaid_sync_locked_at: new Date().toISOString() })
    .eq("id", context.userId)
    .or(`plaid_sync_lock_token.is.null,plaid_sync_locked_at.lt.${staleBefore}`)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Financial sync lock acquisition failed: request failed`);
  return data ? token : null;
}

async function releaseFinancialSyncLease(context: PlaidRefreshContext, token: string) {
  const { error } = await context.supabase
    .from("profiles")
    .update({ plaid_sync_lock_token: null, plaid_sync_locked_at: null })
    .eq("id", context.userId)
    .eq("plaid_sync_lock_token", token);
  if (error) console.error("Financial sync lock release failed");
}

async function runFinancialDataRefresh(context: PlaidRefreshContext): Promise<FinancialSyncResult> {
  const token = await acquireFinancialSyncLease(context);
  if (!token) return { success: true, status: "in_progress", items: [] };
  try {
    const { data, error } = await context.supabase
      .from("plaid_items")
      .select("plaid_item_id, access_token, institution_name, transactions_cursor, credential_id, connection_status, products")
      .eq("user_id", context.userId);
    if (error) throw new Error(`Plaid Item lookup failed: request failed`);
    const items = (data ?? []) as StoredItem[];
    const results = await Promise.all(items.map((item) => refreshItem(context, item)));
    return { success: results.every((item) => item.status === "success"), status: "completed", items: results };
  } finally {
    await releaseFinancialSyncLease(context, token);
  }
}

/**
 * Refreshes only Items owned by the explicitly authenticated user context.
 * The caller must obtain that context through the server-side auth boundary.
 */
export function refreshFinancialData(context: PlaidRefreshContext): Promise<FinancialSyncResult> {
  if (!(plaidRefreshContextBrand in context)) {
    throw new Error("Financial refresh requires an authenticated server context");
  }
  if (!context.userId) throw new Error("A user ID is required for financial refresh");
  const existing = localRefreshes.get(context.userId);
  if (existing) return existing;
  const refresh = runFinancialDataRefresh(context).finally(() => {
    localRefreshes.delete(context.userId);
  });
  localRefreshes.set(context.userId, refresh);
  return refresh;
}
