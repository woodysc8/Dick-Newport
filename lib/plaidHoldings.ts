import { CountryCode, Products, type Item, type PlaidApi, type InvestmentsHoldingsGetResponse, type LinkTokenCreateRequest } from "plaid";
import { createLinkTokenRequest, getUserPlaidClient } from "./plaidClient";
import { decryptPlaidSecret, encryptPlaidSecret } from "./plaidEncryption";
import { PlaidOperationError } from "./plaidOperations";
import type { PlaidUserContext } from "./plaidTenant";
import { isAuthenticatedPlaidContext } from "./plaidTenant";

export function authorizedInvestmentProducts(item: Pick<Item, "products" | "consented_products" | "billed_products">) {
  // Available products indicate capability, not consent. An explicit consent list
  // is authoritative, even when an older subscription appears in billed_products.
  const products = item.consented_products ?? item.products ?? item.billed_products ?? [];
  return [...new Set(products)];
}
export function holdingsFailure(error: unknown) {
  const code = (error as { response?: { data?: { error_code?: string } } })?.response?.data?.error_code;
  if (["PRODUCT_NOT_SUPPORTED", "PRODUCTS_NOT_SUPPORTED", "NO_INVESTMENT_ACCOUNTS"].includes(code ?? "")) return { status: "unsupported", message: "Holdings are unsupported for this connection. Existing records are retained; a separate Investments connection may be needed." };
  if (["ACCESS_NOT_GRANTED", "ADDITIONAL_CONSENT_REQUIRED", "INVALID_PRODUCT", "PRODUCTION_ACCESS_NOT_GRANTED"].includes(code ?? "")) return { status: "permission_required", message: "Investments permission is required. Enable holdings and check Investments access in your personal Plaid Dashboard." };
  if (code === "ITEM_LOGIN_REQUIRED") return { status: "permission_required", message: "This connection needs reauthorization. Use Enable holdings to open update mode; do not replace the saved connection." };
  if (code === "PRODUCT_NOT_READY") return { status: "not_ready", message: "Plaid is still preparing holdings. Retry Sync holdings later; no automatic retry or bank refresh was started." };
  return { status: "error", message: "Holdings could not be imported. Saved positions are retained; retry Sync holdings later." };
}
export async function ownedHoldingsItem(context: PlaidUserContext, connectionId: string) {
  if (!isAuthenticatedPlaidContext(context)) throw new PlaidOperationError("Authentication required", 401);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(connectionId)) throw new PlaidOperationError("Select a saved investment connection");
  const { data: item, error } = await context.supabase.from("plaid_items")
    .select("id, plaid_item_id, credential_id, access_token, connection_status, institution_name, products")
    .eq("user_id", context.userId).eq("id", connectionId).maybeSingle();
  if (error) throw new PlaidOperationError("Connection lookup unavailable", 503);
  if (!item) throw new PlaidOperationError("Connection not found", 404);
  if (item.connection_status !== "active" || !item.credential_id || !item.access_token) throw new PlaidOperationError("This saved connection needs reauthorization in Settings", 409);
  const { client, credentialId } = await getUserPlaidClient(context, item.credential_id);
  const accessToken = decryptPlaidSecret(item.access_token, `item:${context.userId}:${credentialId}:${item.plaid_item_id}`);
  return { item, client, credentialId, accessToken };
}
export async function verifiedHoldingsItem(source: Awaited<ReturnType<typeof ownedHoldingsItem>>) {
  const { data } = await source.client.itemGet({ access_token: source.accessToken });
  if (data.item.item_id !== source.item.plaid_item_id) throw new PlaidOperationError("Connection verification failed", 409);
  return data.item;
}
export async function verifiedInvestmentInstitution(client: PlaidApi, item: Pick<Item, "institution_name" | "institution_id">) {
  if (item.institution_name) return item.institution_name;
  if (!item.institution_id) return null;
  return (await client.institutionsGetById({ institution_id: item.institution_id, country_codes: [CountryCode.Us], options: { include_optional_metadata: true } })).data.institution.name;
}
export async function prepareHoldingsConsent(context: PlaidUserContext, connectionId: string, separate: boolean) {
  const source = await ownedHoldingsItem(context, connectionId);
  const item = await verifiedHoldingsItem(source);
  let request: LinkTokenCreateRequest;
  if (separate) {
    request = createLinkTokenRequest(context.userId, Products.Investments);
  } else {
    if (!item.institution_id) throw new PlaidOperationError("Institution eligibility could not be verified. You can try a separate Investments connection.", 409);
    const result = await source.client.institutionsGetById({ institution_id: item.institution_id, country_codes: [CountryCode.Us], options: { include_optional_metadata: true } });
    if (!result.data.institution.products.includes(Products.Investments)) throw new PlaidOperationError("This institution does not offer Investments on this connection. A separate supported investment connection is required.", 409);
    if (result.data.institution.oauth && !process.env.PLAID_REDIRECT_URI) throw new PlaidOperationError("This institution requires OAuth. Register the Investments return URL in your Plaid Dashboard and configure PLAID_REDIRECT_URI before retrying.", 409);
    const { products: _products, ...base } = createLinkTokenRequest(context.userId);
    void _products;
    request = { ...base, access_token: source.accessToken, additional_consented_products: [Products.Investments] };
  }
  const redirect = process.env.PLAID_REDIRECT_URI;
  if (redirect) request.redirect_uri = redirect;
  const customization = process.env.PLAID_INVESTMENTS_LINK_CUSTOMIZATION;
  if (customization) request.link_customization_name = customization;
  const result = await source.client.linkTokenCreate(request);
  const session = encryptPlaidSecret(JSON.stringify({ credentialId: source.credentialId, connectionId, product: "investments", mode: separate ? "separate" : "update", expires: Date.now() + 30 * 60 * 1000 }), separate ? `link:${context.userId}` : `holdings-update:${context.userId}`);
  return { link_token: result.data.link_token, expiration: result.data.expiration, mode: separate ? "separate" : "update", credential_session: session };
}
export async function verifyHoldingsConsent(context: PlaidUserContext, sessionValue: string) {
  let session;
  try { session = JSON.parse(decryptPlaidSecret(sessionValue, `holdings-update:${context.userId}`)); } catch { throw new PlaidOperationError("Consent session invalid. Start Enable holdings again."); }
  if (session.mode !== "update" || session.product !== "investments" || !Number.isFinite(session.expires) || session.expires < Date.now()) throw new PlaidOperationError("Consent session expired. Start Enable holdings again.");
  const source = await ownedHoldingsItem(context, session.connectionId);
  if (source.credentialId !== session.credentialId) throw new PlaidOperationError("Credentials changed. Start Enable holdings again.", 409);
  const item = await verifiedHoldingsItem(source);
  const products = authorizedInvestmentProducts(item);
  if (!products.includes(Products.Investments)) return { authorized: false, status: "permission_required", message: "Link completed but Plaid has not verified Investments authorization. Check product access and retry Enable holdings." };
  const institutionName = await verifiedInvestmentInstitution(source.client, item);
  const { error } = await context.supabase.from("plaid_items").update({ products, ...(institutionName ? { institution_name: institutionName } : {}) }).eq("user_id", context.userId).eq("id", source.item.id).eq("credential_id", source.credentialId);
  if (error) throw new PlaidOperationError("Consent verified but its saved status could not be updated. Retry verification before syncing.", 503);
  const transactionsPermissionMissing = source.item.products.includes("transactions") && !products.includes(Products.Transactions);
  return { authorized: true, transactionsPermissionMissing, status: "not_synced", message: transactionsPermissionMissing ? "Investments permission verified, but Plaid no longer reports the previous Transactions permission. Existing records are retained. Reopen Enable holdings and keep the original account and Transactions permissions selected." : "Investments permission verified. Choose Sync holdings to import positions. No holdings have been fetched by this consent flow." };
}

/** Validate the complete response before any writes. No missing arrays become []. */
export function holdingsImportPayload(data: InvestmentsHoldingsGetResponse, expectedItem: string) {
  const fail = () => { throw new PlaidOperationError("Holdings response was incomplete or inconsistent. Saved positions are unchanged.", 422); };
  const number = (value: unknown) => { if (value != null && (typeof value !== "number" || !Number.isFinite(value))) fail(); return value == null ? null : value as number; };
  if (data?.item?.item_id !== expectedItem || data.is_investments_fallback_item || !Array.isArray(data.accounts) || !Array.isArray(data.holdings) || !Array.isArray(data.securities) || data.accounts.length > 500 || data.holdings.length > 10000 || data.securities.length > 10000) fail();
  if (data.item.consented_products && !data.item.consented_products.includes(Products.Investments)) fail();
  const accountIds = new Set<string>();
  const accounts = data.accounts.filter((a) => a.type === "investment").map((a) => {
    if (!a.account_id || accountIds.has(a.account_id) || !a.balances || typeof a.name !== "string") fail();
    accountIds.add(a.account_id);
    return { account_id: a.account_id, name: a.name, type: a.type, subtype: a.subtype, mask: a.mask, current_balance: number(a.balances.current), available_balance: number(a.balances.available), currency: a.balances.iso_currency_code ?? a.balances.unofficial_currency_code ?? null, persistent_account_id: (a as typeof a & { persistent_account_id?: string | null }).persistent_account_id ?? null };
  });
  if (!accounts.length) fail(); // No returned investment account is not an empty portfolio.
  const securities = new Map<string, typeof data.securities[number]>();
  for (const security of data.securities) {
    if (!security.security_id || securities.has(security.security_id)) fail();
    securities.set(security.security_id, security);
  }
  const holdings = new Map<string, { account_id: string; security_id: string; security_name: string | null; ticker_symbol: string | null; quantity: number | null; institution_price: number | null; institution_value: number | null; cost_basis: number | null; currency: string | null }>();
  for (const h of data.holdings) {
    if (!accountIds.has(h.account_id) || !securities.has(h.security_id) || !("quantity" in h) || !("institution_value" in h) || !("institution_price" in h)) fail();
    const security = securities.get(h.security_id)!;
    const row = { account_id: h.account_id, security_id: h.security_id, security_name: security.name ?? null, ticker_symbol: security.ticker_symbol ?? null, quantity: number(h.quantity), institution_price: number(h.institution_price), institution_value: number(h.institution_value), cost_basis: number(h.cost_basis), currency: h.iso_currency_code ?? h.unofficial_currency_code ?? null };
    const key = `${h.account_id}:${h.security_id}`, existing = holdings.get(key);
    if (existing && JSON.stringify(existing) !== JSON.stringify(row)) fail();
    holdings.set(key, row);
  }
  return { accounts, holdings: [...holdings.values()] };
}

export async function syncItemHoldings(context: PlaidUserContext, connectionId: string) {
  const source = await ownedHoldingsItem(context, connectionId);
  // Check schema readiness before making a holdings request.
  const readiness = await context.supabase.from("accounts").select("holdings_status, holdings_synced_at").eq("user_id", context.userId).eq("plaid_item_id", source.item.plaid_item_id).limit(1);
  if (readiness.error) throw new PlaidOperationError("Holdings sync awaits the approved local migration. No holdings request was started.", 503);
  try {
    const item = await verifiedHoldingsItem(source);
    if (!authorizedInvestmentProducts(item).includes(Products.Investments)) throw { response: { data: { error_code: "ADDITIONAL_CONSENT_REQUIRED" } } };
    const response = await source.client.investmentsHoldingsGet({ access_token: source.accessToken });
    const payload = holdingsImportPayload(response.data, source.item.plaid_item_id);
    let saved;
    try { saved = await context.supabase.rpc("import_investment_holdings", { owner_id: context.userId, connection_id: source.item.id, expected_credential_id: source.credentialId, payload }); }
    catch { throw new PlaidOperationError("Atomic holdings import result could not be confirmed. Refresh status before retrying; no partial portfolio is committed.", 503); }
    if (saved.error) throw new PlaidOperationError("Atomic holdings import result could not be confirmed. Refresh status before retrying; no partial portfolio is committed.", 503);
    return { success: true, ...saved.data, message: "Holdings imported from Plaid's latest available data. This did not refresh transactions or request new brokerage extraction." };
  } catch (error) {
    const failure = holdingsFailure(error);
    // Only status changes after a failed provider/import response; never positions,
    // balances, or the last successful import timestamp.
    const marked = await context.supabase.from("accounts").update({ holdings_status: failure.status }).eq("user_id", context.userId).eq("plaid_item_id", source.item.plaid_item_id).in("account_type", ["investment", "crypto", "retirement"]);
    if (marked.error) throw new PlaidOperationError("Holdings sync status could not be saved. Refresh status before retrying; the import result may need verification.", 503);
    if (error instanceof PlaidOperationError) throw error;
    return { success: false, ...failure };
  }
}
