import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), createSupabase: vi.fn(), clients: new Map<string, Record<string, ReturnType<typeof vi.fn>>>(), configurations: [] as Record<string, unknown>[] }));
vi.mock("./supabase/server", () => ({ getAuthenticatedSupabaseContext: mocks.auth }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createSupabase }));
vi.mock("plaid", () => ({
  CountryCode: { Us: "US" }, Products: { Transactions: "transactions", Investments: "investments" },
  Configuration: class { constructor(value: Record<string, unknown>) { Object.assign(this, value); } },
  PlaidApi: class {
    constructor(config: { basePath: string; baseOptions: { headers: Record<string, string> } }) {
      mocks.configurations.push(config);
      return mocks.clients.get(config.baseOptions.headers["PLAID-CLIENT-ID"])!;
    }
  },
}));

import { getAuthenticatedPlaidContext } from "./plaidTenant";
import { getUserPlaidClient } from "./plaidClient";
import { decryptPlaidSecret, encryptPlaidSecret } from "./plaidEncryption";
import { GET, POST, PUT, DELETE } from "../app/api/plaid/credentials/route";
import { POST as link } from "../app/api/plaid/create-link-token/route";
import { POST as exchange } from "../app/api/plaid/exchange-token/route";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let locked: Set<string>;
let failInsert = false;
function database() {
  return {
    rpc: async (_name: string, args: { owner_id: string }) => {
      if (locked.has(args.owner_id)) return { data: false, error: null };
      locked.add(args.owner_id);
      return { data: true, error: null };
    },
    from(table: string) {
      const filters: Row = {};
      let operation = "select", values: Row = {}, columns = "";
      const execute = () => {
        const rows = tables[table] ??= [];
        const selected = rows.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
        if (operation === "insert") {
          if (failInsert) return { data: null, error: {} };
          rows.push({ id: crypto.randomUUID(), ...values });
        }
        if (operation === "update") selected.forEach(row => Object.assign(row, values));
        if (operation === "delete") {
          if (table === "user_plaid_operations") locked.delete(String(filters.user_id));
          tables[table] = rows.filter(row => !selected.includes(row));
        }
        const data = selected.map(row => columns ? Object.fromEntries(columns.split(",").map(key => [key.trim(), row[key.trim()]])) : { ...row });
        return { data, error: null };
      };
      const query = {
        select(value: string) { columns = value; return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        update(value: Row) { operation = "update"; values = value; return query; },
        insert(value: Row) { operation = "insert"; values = value; return query; },
        delete() { operation = "delete"; return query; },
        async maybeSingle() { const result = execute(); return { ...result, data: result.data?.[0] ?? null }; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(execute()).then(resolve); },
      };
      return query;
    },
  };
}
const clientA = "a".repeat(24), clientB = "b".repeat(24);
const input = (clientId = clientA, environment = "sandbox") => ({ clientId, secret: "c".repeat(30), environment });
function request(method = "GET", body?: unknown, origin?: string) {
  return new Request("http://localhost/api/plaid/credentials?user_id=user-b", {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(origin ? { Origin: origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function asUser(userId: string | null) { mocks.auth.mockResolvedValue(userId ? { user: { id: userId } } : null); }
function provider() {
  return {
    institutionsGet: vi.fn().mockResolvedValue({ data: {} }),
    itemRemove: vi.fn().mockResolvedValue({ data: {} }),
    linkTokenCreate: vi.fn().mockResolvedValue({ data: { link_token: "synthetic-link", expiration: "2030-01-01" } }),
    itemPublicTokenExchange: vi.fn().mockResolvedValue({ data: { item_id: "synthetic-item", access_token: "synthetic-access" } }),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  tables = {}; locked = new Set(); failInsert = false;
  mocks.clients.clear(); mocks.configurations = [];
  mocks.clients.set(clientA, provider()); mocks.clients.set(clientB, provider());
  mocks.createSupabase.mockReturnValue(database());
  asUser("user-a");
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-service";
  process.env.PLAID_CREDENTIAL_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("personal credential HTTP and storage integration (mock providers)", () => {
  it("isolates two users' credentials, clients, and environments", async () => {
    expect((await POST(request("POST", input()))).status).toBe(200);
    const a = tables.user_plaid_credentials[0];
    asUser("user-b");
    expect((await POST(request("POST", input(clientB, "production")))).status).toBe(200);
    const contextB = (await getAuthenticatedPlaidContext(request()))!;
    await expect(getUserPlaidClient(contextB, String(a.id))).rejects.toThrow("personal Plaid credentials");
    const b = await getUserPlaidClient(contextB);
    expect(b.client).toBe(mocks.clients.get(clientB));
    expect(mocks.configurations.at(-1)?.basePath).toBe("https://production.plaid.com");
    asUser("user-a");
    const contextA = (await getAuthenticatedPlaidContext(request()))!;
    expect((await getUserPlaidClient(contextA)).client).toBe(mocks.clients.get(clientA));
    expect(mocks.configurations.at(-1)?.basePath).toBe("https://sandbox.plaid.com");
    const response = await (await GET(request())).text();
    for (const forbidden of [clientA, input().secret, "encrypted_credentials", String(a.id)]) expect(response).not.toContain(forbidden);
    expect(JSON.stringify(tables)).not.toContain(input().secret);
    expect(JSON.parse(decryptPlaidSecret(String(a.encrypted_credentials), `user-a:${a.id}:sandbox`)).clientId).toBe(clientA);
  });

  it("rejects all unauthenticated credential and active Plaid routes", async () => {
    asUser(null);
    for (const handler of [GET, POST, PUT, DELETE, link, exchange]) {
      expect((await handler(request(handler === GET ? "GET" : "POST", handler === GET ? undefined : input()))).status).toBe(401);
    }
    expect(mocks.configurations).toHaveLength(0);
  });

  it("rejects cross-origin, oversized and invalid credential submissions", async () => {
    expect((await POST(request("POST", input(), "https://attacker.example"))).status).toBe(403);
    expect((await POST(request("POST", { ...input(), secret: "x".repeat(5000) }))).status).toBe(400);
    expect((await POST(request("POST", { ...input(), user_id: "user-b" }))).status).toBe(400);
    expect((await POST(request("POST", input(clientA, "development")))).status).toBe(400);
    expect(mocks.configurations).toHaveLength(0);
  });

  it("verifies saved credentials without returning a secret", async () => {
    await POST(request("POST", input()));
    const response = await POST(request("POST", { action: "verify" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ configured: true, status: "active", verifiedAt: expect.any(String) });
    expect(mocks.clients.get(clientA)!.institutionsGet).toHaveBeenCalledTimes(2);
  });

  it("refuses missing Production access and keeps old credentials during failed replacement verification", async () => {
    await POST(request("POST", input()));
    const previousId = tables.user_plaid_credentials[0].id;
    mocks.clients.get(clientB)!.institutionsGet.mockRejectedValue({ response: { data: { error_code: "PRODUCTION_ACCESS_NOT_GRANTED", error_message: "sensitive-provider-response" } } });
    const response = await PUT(request("PUT", input(clientB, "production")));
    expect(response.status).toBe(422);
    const body = await response.text();
    expect(body).toContain("Production"); expect(body).not.toContain("sensitive-provider-response");
    expect(tables.user_plaid_credentials[0].id).toBe(previousId);
  });

  it("serializes operations and fails closed on contention", async () => {
    locked.add("user-a");
    expect((await POST(request("POST", input()))).status).toBe(409);
    expect(mocks.configurations).toHaveLength(0);
  });

  it("binds Link sessions to credential version and user, and stores Items with the correct credential", async () => {
    await POST(request("POST", input()));
    const session = await (await link(request("POST", { product: "investments" }))).json();
    asUser("user-b");
    expect((await exchange(request("POST", { public_token: "synthetic-public", credential_session: session.credential_session }))).status).toBe(400);
    asUser("user-a");
    expect((await exchange(request("POST", { public_token: "synthetic-public", credential_session: session.credential_session }))).status).toBe(200);
    expect(tables.plaid_items[0]).toMatchObject({ user_id: "user-a", credential_id: tables.user_plaid_credentials[0].id, connection_status: "active", products: ["investments"] });
    await PUT(request("PUT", input(clientB)));
    expect((await exchange(request("POST", { public_token: "synthetic-public", credential_session: session.credential_session }))).status).toBe(409);
    expect(mocks.clients.get(clientB)!.itemPublicTokenExchange).not.toHaveBeenCalled();
  });

  it("revokes dependent Items with old credentials, preserves history and rotates version", async () => {
    await POST(request("POST", input()));
    const previousId = tables.user_plaid_credentials[0].id;
    tables.plaid_items = [{ id: "item-row", plaid_item_id: "synthetic-item", user_id: "user-a", credential_id: previousId, access_token: encryptPlaidSecret("synthetic-access", `item:user-a:${previousId}:synthetic-item`), connection_status: "active" }];
    tables.accounts = [{ id: "historical-account" }]; tables.transactions = [{ id: "historical-transaction" }];
    tables.investment_holdings = [{ id: "historical-holding" }];
    const response = await PUT(request("PUT", input(clientB)));
    expect(response.status).toBe(200);
    expect(mocks.clients.get(clientA)!.itemRemove).toHaveBeenCalledWith({ access_token: "synthetic-access" });
    expect(mocks.clients.get(clientB)!.itemRemove).not.toHaveBeenCalled();
    expect(tables.user_plaid_credentials[0].id).not.toBe(previousId);
    expect(tables.plaid_items[0]).toMatchObject({ credential_id: null, access_token: null, connection_status: "revoked" });
    expect(tables.accounts).toHaveLength(1); expect(tables.transactions).toHaveLength(1); expect(tables.investment_holdings).toHaveLength(1);
    expect((await DELETE(request("DELETE"))).status).toBe(200);
    expect(tables.user_plaid_credentials).toHaveLength(0);
  });

  it("retains disabled credentials and original tokens after failed revocation, then retries safely", async () => {
    await POST(request("POST", input()));
    const previousId = tables.user_plaid_credentials[0].id;
    tables.plaid_items = [{ id: "item-row", plaid_item_id: "synthetic-item", user_id: "user-a", credential_id: previousId, access_token: encryptPlaidSecret("synthetic-access", `item:user-a:${previousId}:synthetic-item`), connection_status: "active" }];
    mocks.clients.get(clientA)!.itemRemove.mockRejectedValueOnce(new Error("sensitive-provider-response"));
    const response = await DELETE(request("DELETE"));
    expect(response.status).toBe(409); expect(await response.text()).not.toContain("sensitive-provider-response");
    expect(tables.user_plaid_credentials[0].status).toBe("revoking");
    expect(String(tables.plaid_items[0].access_token)).toMatch(/^v1\./);
    expect((await link(request("POST"))).status).toBe(409);
    expect((await DELETE(request("DELETE"))).status).toBe(200);
    expect(tables.user_plaid_credentials).toHaveLength(0);
  });

  it("revokes newly exchanged Items if persistence fails", async () => {
    await POST(request("POST", input()));
    const session = await (await link(request("POST"))).json();
    failInsert = true;
    expect((await exchange(request("POST", { public_token: "synthetic-public", credential_session: session.credential_session }))).status).toBe(422);
    expect(mocks.clients.get(clientA)!.itemRemove).toHaveBeenCalledWith({ access_token: "synthetic-access" });
  });

  it("does not request unsupported investment products silently", async () => {
    await POST(request("POST", input()));
    mocks.clients.get(clientA)!.linkTokenCreate.mockRejectedValue({ response: { data: { error_code: "INVALID_PRODUCT", error_message: "sensitive-provider-response" } } });
    const response = await link(request("POST", { product: "investments" }));
    expect(response.status).toBe(422);
    const body = await response.text(); expect(body).toContain("does not support"); expect(body).not.toContain("sensitive-provider-response");
  });
});
