import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPlaidContext: vi.fn(),
  getUserPlaidClient: vi.fn(),
  createPlaidRefreshContext: vi.fn(),
  refreshFinancialData: vi.fn(),
}));

vi.mock("../../../../lib/plaidTenant", () => ({
  getAuthenticatedPlaidContext: mocks.getAuthenticatedPlaidContext,
}));
vi.mock("../../../../lib/plaidClient", () => ({
  getUserPlaidClient: mocks.getUserPlaidClient,
}));
vi.mock("../../../../lib/plaidRefresh", () => ({
  createPlaidRefreshContext: mocks.createPlaidRefreshContext,
  refreshFinancialData: mocks.refreshFinancialData,
}));

vi.mock("../../../../lib/plaidOperations", () => ({ withPlaidOperation: (_context: unknown, work: () => Promise<unknown>) => work() }));
import { POST } from "./route";

const request = (origin?: string) => new Request("http://localhost/api/plaid/refresh?user_id=user-b", {
  method: "POST",
  headers: origin ? { Origin: origin } : undefined,
});

describe("Plaid refresh route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SITE_URL;
    mocks.getUserPlaidClient.mockResolvedValue({ client: { plaid: "server-client" }, credentialId: "credential-a" });
    mocks.createPlaidRefreshContext.mockImplementation((context: unknown, plaidClient: unknown) => ({
      context,
      plaidClient,
    }));
  });

  it("rejects unauthenticated callers before creating a client or synchronizing", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.getUserPlaidClient).not.toHaveBeenCalled();
    expect(mocks.refreshFinancialData).not.toHaveBeenCalled();
  });

  it("allows same-origin browser requests", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue(null);

    const response = await POST(request("http://localhost"));

    expect(response.status).toBe(401);
  });

  it("allows requests without an Origin header", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue(null);

    const response = await POST(request());

    expect(response.status).toBe(401);
  });

  it("rejects cross-origin requests before authentication or Plaid work", async () => {
    const response = await POST(request("https://attacker.example"));

    expect(response.status).toBe(403);
    expect(mocks.getAuthenticatedPlaidContext).not.toHaveBeenCalled();
    expect(mocks.getUserPlaidClient).not.toHaveBeenCalled();
  });

  it("uses the verified context and ignores request-supplied user IDs", async () => {
    const authenticatedContext = { userId: "user-a", supabase: { from: vi.fn() } };
    const refreshContext = { internal: "refresh-context" };
    mocks.getAuthenticatedPlaidContext.mockResolvedValue(authenticatedContext);
    mocks.createPlaidRefreshContext.mockReturnValue(refreshContext);
    mocks.refreshFinancialData.mockResolvedValue({
      success: true,
      status: "completed",
      items: [{
        institution: "Sandbox Bank",
        plaid_item_id: "item-a",
        status: "success",
        accounts_updated: 1,
        accounts_created: 0,
        transactions_added: 2,
        transactions_modified: 0,
        transactions_removed: 0,
        holdings_updated: 0,
        holdings_removed: 0,
        errors: [],
        warnings: [],
      }],
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createPlaidRefreshContext).toHaveBeenCalledWith(
      authenticatedContext,
      { plaid: "server-client" },
      "credential-a",
    );
    expect(mocks.refreshFinancialData).toHaveBeenCalledWith(refreshContext);
    expect((await response.json()).items[0]).toMatchObject({
      plaid_item_id: "item-a",
      transactions_added: 2,
      error_count: 0,
    });
  });

  it("returns an empty successful result for a user with no Items", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: {} });
    mocks.refreshFinancialData.mockResolvedValue({ success: true, status: "completed", items: [] });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: "completed", items: [] });
  });

  it("reports lease contention without starting another synchronization", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: {} });
    mocks.refreshFinancialData.mockResolvedValue({ success: true, status: "in_progress", items: [] });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: "in_progress", items: [] });
  });

  it("returns safe partial-failure summaries without internal errors or access tokens", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: {} });
    mocks.refreshFinancialData.mockResolvedValue({
      success: false,
      status: "completed",
      items: [{
        institution: "Sandbox Bank",
        plaid_item_id: "item-a",
        status: "error",
        accounts_updated: 0,
        accounts_created: 0,
        transactions_added: 0,
        transactions_modified: 0,
        transactions_removed: 0,
        holdings_updated: 0,
        holdings_removed: 0,
        errors: ["database secret", "access-secret"],
        warnings: ["internal warning"],
      }],
    });

    const body = await (await POST(request())).json();

    expect(body).toEqual(expect.objectContaining({ success: false, status: "completed" }));
    expect(body.items[0]).toEqual(expect.objectContaining({ error_count: 2, warning_count: 1 }));
    expect(JSON.stringify(body)).not.toContain("access-secret");
    expect(JSON.stringify(body)).not.toContain("database secret");
  });

  it("fails safely for invalid Plaid configuration or refresh failures", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: {} });
    mocks.getUserPlaidClient.mockImplementation(() => {
      throw new Error("Plaid credentials are not configured");
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to refresh Plaid connections" });
  });
});
