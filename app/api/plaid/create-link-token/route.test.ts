import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedPlaidContext: vi.fn(),
  createPlaidClient: vi.fn(),
  createLinkTokenRequest: vi.fn((userId: string) => ({ user: { client_user_id: userId } })),
}));

vi.mock("../../../../lib/plaidTenant", () => ({
  getAuthenticatedPlaidContext: mocks.getAuthenticatedPlaidContext,
}));
vi.mock("../../../../lib/plaidClient", () => ({
  createPlaidClient: mocks.createPlaidClient,
  createLinkTokenRequest: mocks.createLinkTokenRequest,
}));

import { POST } from "./route";

describe("Plaid Link token route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.getAuthenticatedPlaidContext.mockResolvedValue(null);

    const response = await POST(new Request("http://localhost/api/plaid/create-link-token", { method: "POST" }));

    expect(response.status).toBe(401);
    expect(mocks.createPlaidClient).not.toHaveBeenCalled();
  });

  it("uses the authenticated user identity", async () => {
    const linkTokenCreate = vi.fn().mockResolvedValue({
      data: { link_token: "link-sandbox-safe", expiration: "2026-11-02T15:00:00Z" },
    });
    mocks.getAuthenticatedPlaidContext.mockResolvedValue({ userId: "user-a", supabase: {} });
    mocks.createPlaidClient.mockReturnValue({ linkTokenCreate });

    const response = await POST(new Request("http://localhost/api/plaid/create-link-token?user_id=user-b", { method: "POST" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      link_token: "link-sandbox-safe",
      expiration: "2026-11-02T15:00:00Z",
    });
    expect(mocks.createLinkTokenRequest).toHaveBeenCalledWith("user-a");
    expect(linkTokenCreate).toHaveBeenCalledWith({ user: { client_user_id: "user-a" } });
  });

  it("fails safely when Plaid configuration is invalid", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getAuthenticatedPlaidContext.mockImplementation(async (_request, onStage) => {
      onStage?.("authenticated Supabase context creation");
      onStage?.("authenticated Plaid context creation");
      return { userId: "user-a", supabase: {} };
    });
    mocks.createPlaidClient.mockImplementation(() => {
      throw new Error("Plaid environment is not configured");
    });

    const response = await POST(new Request("http://localhost/api/plaid/create-link-token", { method: "POST" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to create Plaid Link token" });
    expect(log).toHaveBeenCalledWith("Plaid Link token creation failed", expect.objectContaining({
      stage: "Plaid client configuration",
      errorName: "Error",
      message: "Plaid environment is not configured",
    }));
  });

  it("logs only safe Plaid error diagnostics and keeps the browser response generic", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getAuthenticatedPlaidContext.mockImplementation(async (_request, onStage) => {
      onStage?.("authenticated Supabase context creation");
      onStage?.("authenticated Plaid context creation");
      return { userId: "user-a", supabase: {} };
    });
    mocks.createPlaidClient.mockReturnValue({
      linkTokenCreate: vi.fn().mockRejectedValue(Object.assign(new Error("Request failed with status code 400"), {
        name: "AxiosError",
        response: {
          status: 400,
          data: {
            error_type: "INVALID_REQUEST",
            error_code: "INVALID_FIELD",
            request_id: "request_safe-123",
            error_message: "Sensitive detailed response text",
            client_secret: "secret-client-id",
            access_token: "access-token-value",
            email: "private@example.test",
          },
        },
      })),
    });

    const response = await POST(new Request("http://localhost/api/plaid/create-link-token", { method: "POST" }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unable to create Plaid Link token" });
    expect(log).toHaveBeenCalledWith("Plaid Link token creation failed", {
      stage: "linkTokenCreate",
      errorName: "AxiosError",
      httpStatus: 400,
      plaidErrorType: "INVALID_REQUEST",
      plaidErrorCode: "INVALID_FIELD",
      plaidRequestId: "request_safe-123",
      message: "Request failed with status code 400",
    });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("Sensitive detailed response text");
    expect(logged).not.toContain("secret-client-id");
    expect(logged).not.toContain("access-token-value");
    expect(logged).not.toContain("private@example.test");
  });

  it("marks authenticated Supabase context failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getAuthenticatedPlaidContext.mockRejectedValue(new Error("Supabase URL and publishable key are required"));

    const response = await POST(new Request("http://localhost/api/plaid/create-link-token", { method: "POST" }));

    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledWith("Plaid Link token creation failed", expect.objectContaining({
      stage: "authenticated Supabase context creation",
      message: "Supabase URL and publishable key are required",
    }));
  });

  it("marks authenticated Plaid context failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getAuthenticatedPlaidContext.mockImplementation(async (_request, onStage) => {
      onStage?.("authenticated Supabase context creation");
      onStage?.("authenticated Plaid context creation");
      throw new Error("Supabase service credentials are required for Plaid operations");
    });

    const response = await POST(new Request("http://localhost/api/plaid/create-link-token", { method: "POST" }));

    expect(response.status).toBe(500);
    expect(log).toHaveBeenCalledWith("Plaid Link token creation failed", expect.objectContaining({
      stage: "authenticated Plaid context creation",
      message: "Supabase service credentials are required for Plaid operations",
    }));
  });
});
