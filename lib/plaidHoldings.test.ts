import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Products, type InvestmentsHoldingsGetResponse, type Item } from "plaid";
const mocks = vi.hoisted(() => ({ authenticated: vi.fn(), client: vi.fn() }));
vi.mock("./plaidTenant", () => ({ isAuthenticatedPlaidContext: mocks.authenticated }));
vi.mock("./plaidClient", async (original) => ({ ...await original<typeof import("./plaidClient")>(), getUserPlaidClient: mocks.client }));
import { authorizedInvestmentProducts, holdingsFailure, holdingsImportPayload, prepareHoldingsConsent, syncItemHoldings, verifyHoldingsConsent } from "./plaidHoldings";
import { encryptPlaidSecret } from "./plaidEncryption";
import type { PlaidUserContext } from "./plaidTenant";

const connection = "00000000-0000-4000-8000-000000000001";
function response() {
  return { item: { item_id: "fixture-item" }, accounts: [{ account_id: "fixture-account", name: "Robinhood Individual", type: "investment", subtype: "brokerage", mask: "1234", balances: { current: 100, available: null, iso_currency_code: "USD" } }], securities: [{ security_id: "fixture-security", ticker_symbol: "FIX", name: "Fixture ETF" }], holdings: [{ account_id: "fixture-account", security_id: "fixture-security", quantity: 2, institution_price: 50, institution_value: 100, cost_basis: 80, iso_currency_code: "USD" }] } as InvestmentsHoldingsGetResponse;
}
let item: Record<string, unknown>;
let provider: Record<string, ReturnType<typeof vi.fn>>;
let db: { from: ReturnType<typeof vi.fn>; rpc: ReturnType<typeof vi.fn> };
let query: Record<string, ReturnType<typeof vi.fn>>;
let context: PlaidUserContext;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("PLAID_CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  item = { id: connection, user_id: "owner", plaid_item_id: "fixture-item", credential_id: "credential", products: ["transactions"], connection_status: "active", access_token: encryptPlaidSecret("synthetic-access", "item:owner:credential:fixture-item"), transactions_cursor: "unchanged" };
  query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }), maybeSingle: vi.fn(async () => ({ data: item, error: null })), update: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ error: null }), then: vi.fn((resolve) => Promise.resolve({ error: null }).then(resolve)) };
  db = { from: vi.fn().mockReturnValue(query), rpc: vi.fn().mockResolvedValue({ data: { accounts: 1, holdings: 1 }, error: null }) };
  context = { userId: "owner", supabase: db } as unknown as PlaidUserContext;
  provider = { itemGet: vi.fn().mockResolvedValue({ data: { item: { item_id: "fixture-item", institution_id: "ins_fixture", institution_name: "Verified Brokerage", consented_products: ["transactions", "investments"], products: ["transactions"] } } }), institutionsGetById: vi.fn().mockResolvedValue({ data: { institution: { name: "Verified Brokerage", products: ["investments"], oauth: false } } }), linkTokenCreate: vi.fn().mockResolvedValue({ data: { link_token: "synthetic-link", expiration: "2030-01-01" } }), investmentsHoldingsGet: vi.fn().mockResolvedValue({ data: response() }) };
  mocks.authenticated.mockReturnValue(true); mocks.client.mockResolvedValue({ client: provider, credentialId: "credential" });
});
afterEach(() => vi.unstubAllEnvs());
it("checks actual consent, never capability or callback claims", () => {
  expect(authorizedInvestmentProducts({ available_products: [Products.Investments], products: [Products.Transactions], consented_products: [Products.Transactions] } as Item)).toEqual(["transactions"]);
  expect(authorizedInvestmentProducts({ products: [Products.Investments], consented_products: [] } as unknown as Item)).toEqual([]);
});
it("requests update-mode consent with the original credential/token and preserves Item/cursor", async () => {
  const before = { ...item };
  const consent = await prepareHoldingsConsent(context, connection, false);
  expect(provider.linkTokenCreate.mock.calls[0][0]).toMatchObject({ access_token: "synthetic-access", additional_consented_products: ["investments"] });
  expect(provider.linkTokenCreate.mock.calls[0][0].products).toBeUndefined();
  expect(mocks.client).toHaveBeenCalledWith(context, "credential");
  expect(JSON.stringify(consent)).not.toContain("synthetic-access");
  expect(item).toEqual(before); expect(provider.investmentsHoldingsGet).not.toHaveBeenCalled();
  const verified = await verifyHoldingsConsent(context, consent.credential_session);
  expect(verified.authorized).toBe(true);
  expect(query.update).toHaveBeenCalledWith({ products: ["transactions", "investments"], institution_name: "Verified Brokerage" });
  expect(item).toEqual(before); expect(provider.investmentsHoldingsGet).not.toHaveBeenCalled();
});
it("offers a separate Link path without an existing access token or automatic replacement", async () => {
  const before = { ...item };
  expect((await prepareHoldingsConsent(context, connection, true)).mode).toBe("separate");
  expect(provider.linkTokenCreate.mock.calls[0][0]).toMatchObject({ products: ["investments"] });
  expect(provider.linkTokenCreate.mock.calls[0][0].access_token).toBeUndefined(); expect(item).toEqual(before);
});
it("does not mark Investments enabled merely because Link completed", async () => {
  const consent = await prepareHoldingsConsent(context, connection, false);
  provider.itemGet.mockResolvedValueOnce({ data: { item: { item_id: "fixture-item", consented_products: ["transactions"], products: ["transactions"] } } });
  expect(await verifyHoldingsConsent(context, consent.credential_session)).toMatchObject({ authorized: false, status: "permission_required" });
  expect(query.update).not.toHaveBeenCalled(); expect(db.rpc).not.toHaveBeenCalled();
});
it("rejects unsupported upgrades, foreign owners, wrong Item responses and unconfigured OAuth", async () => {
  provider.institutionsGetById.mockResolvedValueOnce({ data: { institution: { products: ["transactions"] } } });
  await expect(prepareHoldingsConsent(context, connection, false)).rejects.toThrow("does not offer Investments");
  expect(provider.linkTokenCreate).not.toHaveBeenCalled();
  query.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
  await expect(prepareHoldingsConsent(context, connection, false)).rejects.toMatchObject({ status: 404 });
  expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
  provider.itemGet.mockResolvedValueOnce({ data: { item: { item_id: "foreign-item" } } });
  await expect(syncItemHoldings(context, connection)).rejects.toThrow("verification failed");
  expect(provider.investmentsHoldingsGet).not.toHaveBeenCalled();
  provider.institutionsGetById.mockResolvedValueOnce({ data: { institution: { products: ["investments"], oauth: true } } });
  await expect(prepareHoldingsConsent(context, connection, false)).rejects.toThrow("requires OAuth");
});
it("validates the complete holdings response, deduplicates identical keys and rejects conflicting/partial data", () => {
  const data = response(); data.holdings.push({ ...data.holdings[0] });
  expect(holdingsImportPayload(data, "fixture-item").holdings).toHaveLength(1);
  data.holdings[1].quantity = 99;
  expect(() => holdingsImportPayload(data, "fixture-item")).toThrow("inconsistent");
  for (const partial of [{ ...response(), securities: [] }, { ...response(), holdings: undefined }, { ...response(), accounts: [] }, { ...response(), item: { item_id: "foreign" } }, { ...response(), is_investments_fallback_item: true }]) expect(() => holdingsImportPayload(partial as InvestmentsHoldingsGetResponse, "fixture-item")).toThrow();
});
it("recognizes an explicit empty response only with a returned eligible account", () => {
  const data = response(); data.holdings = []; data.securities = [];
  expect(holdingsImportPayload(data, "fixture-item")).toMatchObject({ accounts: [{ account_id: "fixture-account" }], holdings: [] });
  data.accounts = [];
  expect(() => holdingsImportPayload(data, "fixture-item")).toThrow();
});
it("imports once atomically, while schema/authorization/provider failures preserve positions and timestamps", async () => {
  expect(await syncItemHoldings(context, connection)).toMatchObject({ success: true, holdings: 1 });
  expect(db.rpc).toHaveBeenCalledWith("import_investment_holdings", expect.objectContaining({ owner_id: "owner", connection_id: connection, expected_credential_id: "credential" }));
  expect(db.from).not.toHaveBeenCalledWith("transactions");
  query.limit.mockResolvedValueOnce({ error: { code: "42703" } }); provider.investmentsHoldingsGet.mockClear();
  await expect(syncItemHoldings(context, connection)).rejects.toThrow("migration"); expect(provider.investmentsHoldingsGet).not.toHaveBeenCalled();
  db.rpc.mockClear(); query.update.mockClear();
  provider.investmentsHoldingsGet.mockRejectedValueOnce({ response: { data: { error_code: "PRODUCT_NOT_READY", error_message: "PRIVATE" } } });
  expect(await syncItemHoldings(context, connection)).toMatchObject({ success: false, status: "not_ready" });
  expect(db.rpc).not.toHaveBeenCalled(); expect(query.update).toHaveBeenCalledWith({ holdings_status: "not_ready" });
  expect(query.eq).toHaveBeenCalledWith("plaid_item_id", "fixture-item");
});
it.each(["ACCESS_NOT_GRANTED", "ADDITIONAL_CONSENT_REQUIRED", "PRODUCT_NOT_SUPPORTED", "PRODUCTS_NOT_SUPPORTED", "PRODUCT_NOT_READY", "ITEM_LOGIN_REQUIRED", "UNKNOWN"])("sanitizes %s and supplies a recovery action", (code) => {
  const result = holdingsFailure({ response: { data: { error_code: code, error_message: "PRIVATE" } } });
  expect(result.message).not.toContain("PRIVATE"); expect(result.status).toBeTruthy();
});
it("does not assert unchanged holdings when the RPC transport outcome is ambiguous", async () => {
  db.rpc.mockRejectedValueOnce(new Error("PRIVATE transport payload"));
  await expect(syncItemHoldings(context, connection)).rejects.toThrow("result could not be confirmed");
  expect(query.update).toHaveBeenCalledWith({ holdings_status: "error" });
});
