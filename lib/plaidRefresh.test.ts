import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPlaidRefreshContext, type PlaidRefreshContext } from "./plaidRefresh";
import { getAuthenticatedPlaidContext } from "./plaidTenant";
import { encryptPlaidSecret } from "./plaidEncryption";

const authMocks = vi.hoisted(() => ({
  getAuthenticatedSupabaseContext: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("./supabase/server", () => ({
  getAuthenticatedSupabaseContext: authMocks.getAuthenticatedSupabaseContext,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: authMocks.createClient,
}));

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  items: [] as Row[],
  accounts: [] as Row[],
  transactions: [] as Row[],
  holdings: [] as Row[],
  snapshots: [] as Row[],
  profiles: new Set<string>(),
  forceAccountRace: false,
  forceTransactionRace: false,
  failRecoveryUpdate: false,
  updates: [] as Array<{ table: string; filters: Record<string, unknown> }>,
}));

function fakeSupabase() {
  return {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let operation = "select";
      let updateValues: Row = {};
      const query: Record<string, unknown> = {
        select: vi.fn(() => {
          if (operation === "select") operation = "select";
          return query;
        }),
        eq: vi.fn((column: string, value: unknown) => {
          filters[column] = value;
          return query;
        }),
        or: vi.fn(() => query),
        update: vi.fn((values: Row) => {
          operation = "update";
          updateValues = values;
          return query;
        }),
        insert: vi.fn((values: Row) => {
          operation = "insert";
          updateValues = values;
          return query;
        }),
        upsert: vi.fn((values: Row) => {
          operation = "upsert";
          updateValues = values;
          return query;
        }),
        delete: vi.fn(() => {
          operation = "delete";
          return query;
        }),
        maybeSingle: vi.fn(async () => {
          if (
            operation === "select" &&
            table === "accounts" &&
            state.forceAccountRace &&
            !state.updates.some((entry) => entry.table === "accounts")
          ) {
            state.forceAccountRace = false;
            return { data: null, error: null };
          }
          if (
            operation === "select" &&
            table === "transactions" &&
            state.forceTransactionRace &&
            !state.updates.some((entry) => entry.table === "transactions")
          ) {
            state.forceTransactionRace = false;
            return { data: null, error: null };
          }
          const rows = tableRows(table).filter((row) => matches(row, filters));
          if (table === "profiles" && operation === "update") {
            const userId = String(filters.id);
            const acquired = !state.profiles.has(userId) || !state.profiles.has(`${userId}:locked`);
            if (updateValues.plaid_sync_lock_token) {
              if (!acquired) return { data: null, error: null };
              state.profiles.add(`${userId}:locked`);
              return { data: { id: userId }, error: null };
            }
            state.profiles.delete(`${userId}:locked`);
            return { data: null, error: null };
          }
          return { data: rows[0] ?? null, error: null };
        }),
        then: (resolve: (value: unknown) => unknown) => {
          const rows = tableRows(table);
          if (operation === "select") return resolve({ data: rows.filter((row) => matches(row, filters)), error: null });
          if (operation === "insert") {
            const duplicate = rows.some((row) =>
              table === "accounts"
                ? row.user_id === updateValues.user_id && row.plaid_item_id === updateValues.plaid_item_id && row.plaid_account_id === updateValues.plaid_account_id
                : table === "transactions" && row.user_id === updateValues.user_id && row.plaid_transaction_id === updateValues.plaid_transaction_id,
            );
            if (duplicate) return resolve({ data: null, error: { code: "23505", message: "duplicate" } });
            rows.push({ ...updateValues, id: `${table}-${rows.length + 1}` });
            return resolve({ data: null, error: null });
          }
          if (operation === "update") {
            state.updates.push({ table, filters: { ...filters } });
            if (state.failRecoveryUpdate && (table === "accounts" || table === "transactions")) {
              state.failRecoveryUpdate = false;
              return resolve({ data: null, error: { code: "UPDATE_FAILED", message: "recovery update failed" } });
            }
            for (const row of rows.filter((candidate) => matches(candidate, filters))) Object.assign(row, updateValues);
            return resolve({ data: null, error: null });
          }
          if (operation === "upsert") {
            const conflict = table === "investment_holdings"
              ? (row: Row) => row.user_id === updateValues.user_id &&
                row.plaid_account_id === updateValues.plaid_account_id &&
                row.security_id === updateValues.security_id
              : (row: Row) => row.user_id === updateValues.user_id &&
                row.plaid_account_id === updateValues.plaid_account_id &&
                row.snapshot_date === updateValues.snapshot_date;
            const existing = rows.find(conflict);
            if (existing) Object.assign(existing, updateValues);
            else rows.push({ ...updateValues, id: `${table}-${rows.length + 1}` });
            return resolve({ data: null, error: null });
          }
          if (operation === "delete") {
            const deleted = rows.filter((row) => matches(row, filters));
            const retained = rows.filter((row) => !matches(row, filters));
            rows.splice(0, rows.length, ...retained);
            return resolve({ data: deleted, error: null });
          }
          return resolve({ data: null, error: null });
        },
      };
      return query;
    },
  };
}

function tableRows(table: string) {
  if (table === "plaid_items") return state.items;
  if (table === "accounts") return state.accounts;
  if (table === "transactions") return state.transactions;
  if (table === "investment_holdings") return state.holdings;
  if (table === "investment_snapshots") return state.snapshots;
  if (table === "profiles") return [];
  return [];
}

function matches(row: Row, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}

async function context(userId: string, items: Row[], plaidClient: Record<string, unknown>): Promise<PlaidRefreshContext> {
  for (const item of items) {
    if (typeof item.access_token === "string" && !item.access_token.startsWith("v1.")) {
      item.access_token = encryptPlaidSecret(item.access_token, `item:${item.user_id}:${item.credential_id}:${item.plaid_item_id}`);
    }
  }
  const supabase = fakeSupabase();
  authMocks.getAuthenticatedSupabaseContext.mockResolvedValueOnce({
    user: { id: userId },
    supabase: {},
  });
  authMocks.createClient.mockReturnValueOnce(supabase);
  const authenticatedContext = await getAuthenticatedPlaidContext(new Request("http://localhost"));
  if (!authenticatedContext) throw new Error("Expected authenticated context");
  return createPlaidRefreshContext(authenticatedContext, plaidClient as never, "credential-a");
}

describe("tenant-safe financial refresh", () => {
  it("blocks legacy, revoked, and unrelated credential versions before any provider request", async () => {
    const { refreshFinancialData } = await import("./plaidRefresh");
    for (const [credentialId, status] of [[null, "reconnect_required"], ["old-version", "active"], ["credential-a", "revoked"]]) {
      state.items = [{ user_id: "user-a", plaid_item_id: "item-a", access_token: "synthetic-token", credential_id: credentialId, connection_status: status, products: ["transactions"] }];
      const client = { accountsGet: vi.fn(), transactionsSync: vi.fn(), investmentsHoldingsGet: vi.fn() };
      const result = await refreshFinancialData(await context("user-a", state.items, client));
      expect(result.success).toBe(false);
      expect(client.accountsGet).not.toHaveBeenCalled();
      expect(client.transactionsSync).not.toHaveBeenCalled();
    }
  });

  it("preserves missing balances as null and skips products absent from the connection", async () => {
    state.items = [{ user_id: "user-a", plaid_item_id: "item-a", access_token: "synthetic-token", credential_id: "credential-a", connection_status: "active", products: [] }];
    const client = {
      accountsGet: vi.fn().mockResolvedValue({ data: { accounts: [{ account_id: "account-a", type: "investment", balances: { current: null, available: null } }] } }),
      transactionsSync: vi.fn(), investmentsHoldingsGet: vi.fn(),
    };
    const { refreshFinancialData } = await import("./plaidRefresh");
    const result = await refreshFinancialData(await context("user-a", state.items, client));
    expect(result.success).toBe(true);
    expect(state.accounts[0]).toMatchObject({ current_balance: null, available_balance: null });
    expect(client.transactionsSync).not.toHaveBeenCalled();
    expect(client.investmentsHoldingsGet).not.toHaveBeenCalled();
  });

  it("preserves saved holdings when investment access is unavailable", async () => {
    state.items = [{ user_id: "user-a", plaid_item_id: "item-a", access_token: "synthetic-token", credential_id: "credential-a", connection_status: "active", products: ["investments"] }];
    state.accounts = [{ user_id: "user-a", plaid_item_id: "item-a", plaid_account_id: "account-a", account_type: "investment", current_balance: null }];
    state.holdings = [{ id: "historic-holding", user_id: "user-a", plaid_item_id: "item-a" }];
    const client = { accountsGet: vi.fn().mockResolvedValue({ data: { accounts: [] } }),
      investmentsHoldingsGet: vi.fn().mockRejectedValue({ response: { data: { error_code: "ACCESS_NOT_GRANTED", error_message: "sensitive-value" } } }) };
    const { refreshFinancialData } = await import("./plaidRefresh");
    const result = await refreshFinancialData(await context("user-a", state.items, client));
    expect(result.items[0].warnings).toContain("Investments are not available for this Item.");
    expect(state.holdings).toHaveLength(1);
    expect(state.snapshots).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("sensitive-value");
  });
  beforeEach(() => {
    process.env.PLAID_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    state.items = [];
    state.accounts = [];
    state.transactions = [];
    state.holdings = [];
    state.snapshots = [];
    state.profiles = new Set();
    state.forceAccountRace = false;
    state.forceTransactionRace = false;
    state.failRecoveryUpdate = false;
    state.updates = [];
    authMocks.getAuthenticatedSupabaseContext.mockReset();
    authMocks.createClient.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-test-key";
  });

  it("coalesces overlapping refreshes per user", async () => {
    state.items.push({ user_id: "user-a", plaid_item_id: "item-a", access_token: "server-token", institution_name: "Bank A", transactions_cursor: null, credential_id: "credential-a", connection_status: "active", products: ["transactions", "investments"] });
    const plaidClient = {
      accountsGet: vi.fn().mockResolvedValue({ data: { accounts: [] } }),
      transactionsSync: vi.fn().mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: "cursor-a", has_more: false } }),
      investmentsHoldingsGet: vi.fn(),
    };
    const { refreshFinancialData } = await import("./plaidRefresh");
    const first = context("user-a", state.items, plaidClient).then(refreshFinancialData);
    const second = context("user-a", state.items, plaidClient).then(refreshFinancialData);

    const results = await Promise.all([first, second]);
    expect(results[0]).toMatchObject({ success: true, status: "completed" });
    expect(results[1]).toEqual(results[0]);
    expect(plaidClient.accountsGet).toHaveBeenCalledTimes(1);
  });

  it("rejects an untrusted hand-built refresh context", async () => {
    const { refreshFinancialData } = await import("./plaidRefresh");
    expect(() => refreshFinancialData({
      userId: "user-a",
      supabase: fakeSupabase(),
      plaidClient: {},
    } as unknown as PlaidRefreshContext)).toThrow("authenticated server context");
  });

  it("rejects a forged refresh capability for another user", () => {
    expect(() => createPlaidRefreshContext({
      userId: "user-b",
      supabase: fakeSupabase() as never,
    } as never, {} as never, "credential-a")).toThrow("verified authenticated context");
  });

  it("uses the verified Auth user when constructing a refresh context", async () => {
    const refreshContext = await context("user-a", [], {});
    expect(refreshContext.userId).toBe("user-a");
  });

  it("cannot construct a refresh context when authentication fails", async () => {
    authMocks.getAuthenticatedSupabaseContext.mockResolvedValueOnce(null);
    const authenticatedContext = await getAuthenticatedPlaidContext(new Request("http://localhost"));
    expect(authenticatedContext).toBeNull();
    expect(() => createPlaidRefreshContext(authenticatedContext as never, {} as never, "credential-a"))
      .toThrow("verified authenticated context");
  });

  it("keeps repeated account and transaction syncs idempotent and preserves missing currency", async () => {
    state.items.push({ user_id: "user-a", plaid_item_id: "item-a", access_token: "server-token", institution_name: "Bank A", transactions_cursor: null, credential_id: "credential-a", connection_status: "active", products: ["transactions", "investments"] });
    const plaidClient = {
      accountsGet: vi.fn().mockResolvedValue({
        data: {
          accounts: [{
            account_id: "account-a",
            name: "Checking",
            type: "depository",
            subtype: "checking",
            balances: { current: 100, available: 90, iso_currency_code: null, unofficial_currency_code: null },
          }],
        },
      }),
      transactionsSync: vi.fn().mockResolvedValue({
        data: {
          added: [{ transaction_id: "transaction-a", account_id: "account-a", date: "2026-11-02", name: "Coffee", amount: 5 }],
          modified: [],
          removed: [],
          next_cursor: "cursor-a",
          has_more: false,
        },
      }),
      investmentsHoldingsGet: vi.fn(),
    };
    const { refreshFinancialData } = await import("./plaidRefresh");
    await refreshFinancialData(await context("user-a", state.items, plaidClient));
    state.items[0].transactions_cursor = null;
    await refreshFinancialData(await context("user-a", state.items, plaidClient));

    expect(state.accounts).toHaveLength(1);
    expect(state.accounts[0].currency).toBeNull();
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].account_id).toBe(state.accounts[0].id);
  });

  it("never refreshes another user's Item or data", async () => {
    state.items.push(
      { user_id: "user-a", plaid_item_id: "item-a", access_token: "token-a", institution_name: "Bank A", transactions_cursor: null, credential_id: "credential-a", connection_status: "active", products: ["transactions", "investments"] },
      { user_id: "user-b", plaid_item_id: "item-b", access_token: "token-b", institution_name: "Bank B", transactions_cursor: null, credential_id: "credential-a", connection_status: "active", products: ["transactions", "investments"] },
    );
    const plaidClient = {
      accountsGet: vi.fn().mockResolvedValue({ data: { accounts: [] } }),
      transactionsSync: vi.fn().mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: "cursor", has_more: false } }),
      investmentsHoldingsGet: vi.fn(),
    };
    const { refreshFinancialData } = await import("./plaidRefresh");
    await refreshFinancialData(await context("user-a", state.items, plaidClient));

    expect(plaidClient.accountsGet).toHaveBeenCalledTimes(1);
    expect(plaidClient.accountsGet).toHaveBeenCalledWith({ access_token: "token-a" });
    expect(state.items[1].transactions_cursor).toBeNull();
  });

  it("progresses through multiple transaction pages and persists each cursor", async () => {
    state.items.push({ user_id: "user-a", plaid_item_id: "item-a", access_token: "token-a", institution_name: "Bank A", transactions_cursor: null, credential_id: "credential-a", connection_status: "active", products: ["transactions", "investments"] });
    const plaidClient = {
      accountsGet: vi.fn().mockResolvedValue({ data: { accounts: [] } }),
      transactionsSync: vi.fn()
        .mockResolvedValueOnce({ data: { added: [], modified: [], removed: [], next_cursor: "cursor-1", has_more: true } })
        .mockResolvedValueOnce({ data: { added: [], modified: [], removed: [], next_cursor: "cursor-2", has_more: false } }),
      investmentsHoldingsGet: vi.fn(),
    };
    const { refreshFinancialData } = await import("./plaidRefresh");
    await refreshFinancialData(await context("user-a", state.items, plaidClient));

    expect(plaidClient.transactionsSync).toHaveBeenNthCalledWith(1, { access_token: "token-a", cursor: "" });
    expect(plaidClient.transactionsSync).toHaveBeenNthCalledWith(2, { access_token: "token-a", cursor: "cursor-1" });
    expect(state.items[0].transactions_cursor).toBe("cursor-2");
  });

  it("reconciles a posted transaction with its pending predecessor across pages and on replay", async () => {
    state.items.push({ user_id: "user-a", plaid_item_id: "item-a", access_token: "token-a", institution_name: "Bank A", transactions_cursor: null, credential_id: "credential-a", connection_status: "active", products: ["transactions", "investments"] });
    state.accounts.push({ id: "account-row", user_id: "user-a", plaid_item_id: "item-a", plaid_account_id: "account-a" });
    state.transactions.push(
      { id: "pending-row", user_id: "user-a", account_id: "account-row", plaid_transaction_id: "pending-txn", pending: true, name: "Coffee" },
      { id: "manual-row", user_id: "user-a", account_id: null, plaid_transaction_id: null, pending: false, name: "Manual transaction" },
      { id: "other-account-row", user_id: "user-a", account_id: "other-account", plaid_transaction_id: "other-txn", pending: true, name: "Other account pending" },
    );
    const plaidClient = {
      accountsGet: vi.fn().mockResolvedValue({
        data: { accounts: [{ account_id: "account-a", name: "Checking", type: "depository", subtype: "checking", balances: { current: 100, available: 90 } }] },
      }),
      transactionsSync: vi.fn()
        .mockResolvedValueOnce({ data: {
          added: [{ transaction_id: "posted-txn", pending_transaction_id: "pending-txn", account_id: "account-a", date: "2026-11-03", name: "Coffee", amount: 5, pending: false }],
          modified: [], removed: [], next_cursor: "cursor-1", has_more: true,
        } })
        .mockResolvedValueOnce({ data: {
          added: [], modified: [], removed: [{ transaction_id: "pending-txn", account_id: "account-a" }], next_cursor: "cursor-2", has_more: false,
        } }),
      investmentsHoldingsGet: vi.fn(),
    };
    const { refreshFinancialData } = await import("./plaidRefresh");

    const firstResult = await refreshFinancialData(await context("user-a", state.items, plaidClient));
    expect(state.transactions).toHaveLength(3);
    expect(state.transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ plaid_transaction_id: "posted-txn", pending: false }),
      expect.objectContaining({ id: "manual-row", plaid_transaction_id: null }),
      expect.objectContaining({ id: "other-account-row", plaid_transaction_id: "other-txn" }),
    ]));
    expect(state.transactions.some((transaction) => transaction.plaid_transaction_id === "pending-txn")).toBe(false);
    expect(firstResult.items[0]).toMatchObject({ transactions_added: 1, transactions_removed: 1 });

    state.items[0].transactions_cursor = null;
    plaidClient.transactionsSync
      .mockResolvedValueOnce({ data: {
        added: [{ transaction_id: "posted-txn", pending_transaction_id: "pending-txn", account_id: "account-a", date: "2026-11-03", name: "Coffee", amount: 5, pending: false }],
        modified: [], removed: [], next_cursor: "cursor-1", has_more: true,
      } })
      .mockResolvedValueOnce({ data: {
        added: [], modified: [], removed: [{ transaction_id: "pending-txn", account_id: "account-a" }], next_cursor: "cursor-2", has_more: false,
      } });
    await refreshFinancialData(await context("user-a", state.items, plaidClient));

    expect(state.transactions).toHaveLength(3);
    expect(state.transactions.filter((transaction) => transaction.plaid_transaction_id === "posted-txn")).toHaveLength(1);
    expect(state.transactions.some((transaction) => transaction.plaid_transaction_id === "pending-txn")).toBe(false);
  });

  it("recovers account and transaction insert races with complete identity filters", async () => {
    state.items.push({ user_id: "user-a", plaid_item_id: "item-a", access_token: "token-a", institution_name: "Bank A", transactions_cursor: null, credential_id: "credential-a", connection_status: "active", products: ["transactions", "investments"] });
    state.accounts.push({ id: "account-row", user_id: "user-a", plaid_item_id: "item-a", plaid_account_id: "account-a" });
    state.transactions.push({ id: "transaction-row", user_id: "user-a", plaid_transaction_id: "transaction-a" });
    state.forceAccountRace = true;
    state.forceTransactionRace = true;
    const plaidClient = {
      accountsGet: vi.fn().mockResolvedValue({
        data: { accounts: [{ account_id: "account-a", name: "Checking", balances: { current: 10, available: 10 } }] },
      }),
      transactionsSync: vi.fn().mockResolvedValue({
        data: { added: [{ transaction_id: "transaction-a", date: "2026-11-02", name: "Coffee", amount: 5 }], modified: [], removed: [], next_cursor: "cursor", has_more: false },
      }),
      investmentsHoldingsGet: vi.fn(),
    };
    const { refreshFinancialData } = await import("./plaidRefresh");
    await refreshFinancialData(await context("user-a", state.items, plaidClient));

    expect(state.updates).toEqual(expect.arrayContaining([
      { table: "accounts", filters: expect.objectContaining({ id: "account-row", user_id: "user-a", plaid_item_id: "item-a", plaid_account_id: "account-a" }) },
      { table: "transactions", filters: expect.objectContaining({ id: "transaction-row", user_id: "user-a", plaid_transaction_id: "transaction-a" }) },
    ]));
  });

  it("surfaces recovery update failures instead of reporting a successful item", async () => {
    state.items.push({ user_id: "user-a", plaid_item_id: "item-a", access_token: "token-a", institution_name: "Bank A", transactions_cursor: null, credential_id: "credential-a", connection_status: "active", products: ["transactions", "investments"] });
    state.accounts.push({ id: "account-row", user_id: "user-a", plaid_item_id: "item-a", plaid_account_id: "account-a" });
    state.forceAccountRace = true;
    state.failRecoveryUpdate = true;
    const plaidClient = {
      accountsGet: vi.fn().mockResolvedValue({
        data: { accounts: [{ account_id: "account-a", name: "Checking", balances: { current: 10, available: 10 } }] },
      }),
      transactionsSync: vi.fn().mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: "cursor", has_more: false } }),
      investmentsHoldingsGet: vi.fn(),
    };
    const { refreshFinancialData } = await import("./plaidRefresh");
    const result = await refreshFinancialData(await context("user-a", state.items, plaidClient));

    expect(result.items[0]).toMatchObject({ status: "error" });
    expect(result.items[0].errors.join(" ")).toContain("Refresh step failed");
  });

  it("upserts holdings, removes stale holdings, and writes a currency-safe snapshot", async () => {
    state.items.push({ user_id: "user-a", plaid_item_id: "item-a", access_token: "token-a", institution_name: "Robinhood", transactions_cursor: null, credential_id: "credential-a", connection_status: "active", products: ["transactions", "investments"] });
    state.accounts.push({ id: "account-row", user_id: "user-a", plaid_item_id: "item-a", plaid_account_id: "account-a", account_type: "investment", current_balance: 125 });
    state.holdings.push({ id: "stale", user_id: "user-a", plaid_item_id: "item-a", plaid_account_id: "account-a", security_id: "old" });
    const plaidClient = {
      accountsGet: vi.fn().mockResolvedValue({ data: { accounts: [] } }),
      transactionsSync: vi.fn().mockResolvedValue({ data: { added: [], modified: [], removed: [], next_cursor: "cursor", has_more: false } }),
      investmentsHoldingsGet: vi.fn().mockResolvedValue({
        data: {
          holdings: [{ account_id: "account-a", security_id: "security-a", quantity: 1, institution_value: 125, institution_price: 125, iso_currency_code: "USD" }],
          securities: [{ security_id: "security-a", ticker_symbol: "VOO", name: "Fund", iso_currency_code: "USD" }],
        },
      }),
    };
    const { refreshFinancialData } = await import("./plaidRefresh");
    const result = await refreshFinancialData(await context("user-a", state.items, plaidClient));

    expect(result.items[0]).toMatchObject({ holdings_updated: 1, holdings_removed: 1 });
    expect(state.holdings).toHaveLength(1);
    expect(state.snapshots[0].securities_value).toBe(125);
  });
});
