import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSupabaseContext: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("./supabase/server", () => ({
  getAuthenticatedSupabaseContext: mocks.getAuthenticatedSupabaseContext,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

import { getAuthenticatedPlaidContext, getScheduledPlaidContext, isAuthenticatedPlaidContext, verifyPlaidItemOwnership } from "./plaidTenant";
afterEach(() => vi.unstubAllEnvs());

function ownershipClient(result: { data: unknown; error: { message: string } | null }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  return { from: vi.fn(() => query), query };
}

describe("Plaid tenant boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-test-key";
    mocks.createClient.mockReturnValue({ from: vi.fn() });
  });

  it("does not establish a context for an unauthenticated request", async () => {
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue(null);

    await expect(getAuthenticatedPlaidContext(new Request("http://localhost"))).resolves.toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("requires an enabled schedule, exact secret and verified configured owner for delegation", async () => {
    const owner = "00000000-0000-4000-8000-000000000001", secret = "fixture-scheduler-secret-at-least-32-characters";
    vi.stubEnv("CRON_SECRET", secret); vi.stubEnv("SCHEDULED_FINANCE_OWNER_USER_ID", owner); vi.stubEnv("SCHEDULED_FINANCE_ENABLED", "false");
    const request = new Request("https://fixture.invalid?user_id=other", { headers: { authorization: `Bearer ${secret}` } });
    expect(await getScheduledPlaidContext(request)).toBeNull();
    vi.stubEnv("SCHEDULED_FINANCE_ENABLED", "true");
    expect(await getScheduledPlaidContext(new Request("https://fixture.invalid"))).toBeNull();
    expect(mocks.createClient).not.toHaveBeenCalled();
    const getUserById = vi.fn().mockResolvedValue({ data: { user: { id: owner } }, error: null }); mocks.createClient.mockReturnValue({ auth: { admin: { getUserById } } });
    const context = await getScheduledPlaidContext(request);
    expect(context?.userId).toBe(owner); expect(isAuthenticatedPlaidContext(context)).toBe(true); expect(getUserById).toHaveBeenCalledWith(owner);
    getUserById.mockResolvedValue({ data: { user: { id: owner, banned_until: "2999-01-01" } }, error: null });
    expect(await getScheduledPlaidContext(request)).toBeNull();
  });

  it("establishes context from the authenticated user and not request data", async () => {
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue({
      user: { id: "user-a" },
      supabase: {},
    });

    const context = await getAuthenticatedPlaidContext(new Request("http://localhost?user_id=user-b"));

    expect(context?.userId).toBe("user-a");
    expect(mocks.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "server-only-test-key",
      expect.any(Object),
    );
  });

  it("does not verify an Item owned by another user", async () => {
    const { query } = ownershipClient({ data: null, error: null });
    const result = await verifyPlaidItemOwnership({ from: vi.fn(() => query) } as never, "user-a", "item-b");

    expect(result).toEqual({ item: null, error: null });
    expect(query.eq).toHaveBeenNthCalledWith(1, "user_id", "user-a");
    expect(query.eq).toHaveBeenNthCalledWith(2, "plaid_item_id", "item-b");
  });

  it("verifies an Item owned by the authenticated user", async () => {
    const item = { id: "row-a", plaid_item_id: "item-a", institution_name: "Sandbox Bank" };
    const { query } = ownershipClient({ data: item, error: null });

    const result = await verifyPlaidItemOwnership({ from: vi.fn(() => query) } as never, "user-a", "item-a");

    expect(result).toEqual({ item, error: null });
    expect(result.item).not.toHaveProperty("access_token");
  });

  it("denies access when the ownership lookup fails", async () => {
    const { query } = ownershipClient({ data: null, error: { message: "database unavailable" } });

    const result = await verifyPlaidItemOwnership({ from: vi.fn(() => query) } as never, "user-a", "item-a");

    expect(result.item).toBeNull();
    expect(result.error?.message).toContain("ownership lookup failed");
  });

  it("never returns an access token even if the database response contains one", async () => {
    const { query } = ownershipClient({
      data: { id: "row-a", plaid_item_id: "item-a", institution_name: "Sandbox Bank", access_token: "secret" },
      error: null,
    });

    const result = await verifyPlaidItemOwnership({ from: vi.fn(() => query) } as never, "user-a", "item-a");

    expect(result.item).toEqual({ id: "row-a", plaid_item_id: "item-a", institution_name: "Sandbox Bank" });
    expect(result.item).not.toHaveProperty("access_token");
  });
});
