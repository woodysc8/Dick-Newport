import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPlaidContext: vi.fn(),
  createPlaidClient: vi.fn(),
}));

vi.mock("../../../../lib/plaidTenant", () => ({
  getAuthenticatedPlaidContext: mocks.getAuthenticatedPlaidContext,
}));
vi.mock("../../../../lib/plaidClient", () => ({
  createPlaidClient: mocks.createPlaidClient,
}));

import { POST } from "./route";

function databaseClient(options: {
  existing?: { user_id: string; institution_name: string | null } | null;
  lookupError?: { message: string } | null;
  persistenceError?: { message: string } | null;
}) {
  const query = {
    mode: "lookup",
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({ data: options.existing ?? null, error: options.lookupError ?? null }),
    update: vi.fn(() => { query.mode = "update"; return query; }),
    insert: vi.fn(() => { query.mode = "insert"; return query; }),
    then: (resolve: (value: unknown) => unknown) => resolve({ error: options.persistenceError ?? null }),
  };
  return { from: vi.fn(() => query), query };
}

function request(body: unknown) {
  return new Request("http://localhost/api/plaid/exchange-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Plaid public-token exchange route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPlaidClient.mockReturnValue({
      itemPublicTokenExchange: vi.fn().mockResolvedValue({
        data: { item_id: "item-a", access_token: "access-secret" },
      }),
    });
  });

  it("rejects unauthenticated requests before calling Plaid", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue(null);

    const response = await POST(request({ public_token: "public-sandbox-token" }));

    expect(response.status).toBe(401);
    expect(mocks.createPlaidClient).not.toHaveBeenCalled();
  });

  it("rejects invalid request bodies", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: {} });

    for (const body of [{}, { public_token: "" }, { public_token: 42 }, { public_token: "x".repeat(513) }]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
    expect(mocks.createPlaidClient).not.toHaveBeenCalled();
  });

  it("stores a new Item under the authenticated user only", async () => {
    const database = databaseClient({});
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: database });

    const response = await POST(request({ public_token: "public-sandbox-token" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      connected: true,
      plaid_item_id: "item-a",
      institution_name: null,
    });
    expect(database.query.insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: "user-a",
      plaid_item_id: "item-a",
      access_token: "access-secret",
    }));
  });

  it("updates an existing Item only when it already belongs to the user", async () => {
    const database = databaseClient({ existing: { user_id: "user-a", institution_name: "Sandbox Bank" } });
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: database });

    const response = await POST(request({ public_token: "public-sandbox-token" }));

    expect(response.status).toBe(200);
    expect(database.query.update).toHaveBeenCalled();
    expect(database.query.insert).not.toHaveBeenCalled();
  });

  it("never reassigns an Item owned by another user", async () => {
    const database = databaseClient({ existing: { user_id: "user-b", institution_name: "Other Bank" } });
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: database });

    const response = await POST(request({ public_token: "public-sandbox-token" }));

    expect(response.status).toBe(409);
    expect(database.query.update).not.toHaveBeenCalled();
    expect(database.query.insert).not.toHaveBeenCalled();
  });

  it("returns a safe error when persistence fails", async () => {
    const database = databaseClient({ persistenceError: { message: "duplicate or database failure" } });
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: database });

    const response = await POST(request({ public_token: "public-sandbox-token" }));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("duplicate or database failure");
  });

  it("handles Plaid failures without exposing secrets", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: {} });
    mocks.createPlaidClient.mockReturnValue({
      itemPublicTokenExchange: vi.fn().mockRejectedValue(new Error("access-secret")),
    });

    const response = await POST(request({ public_token: "public-sandbox-token" }));

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("access-secret");
  });
});
