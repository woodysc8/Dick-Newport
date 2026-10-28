import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ getAuthenticatedSupabaseContext: vi.fn() }));
vi.mock("../../../../lib/supabase/server", () => authMock);

describe("disabled Plaid endpoints", () => {
  beforeEach(() => authMock.getAuthenticatedSupabaseContext.mockReset());

  it("rejects unauthenticated requests before any Plaid work", async () => {
    authMock.getAuthenticatedSupabaseContext.mockResolvedValue(null);
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/plaid/create-bilt-repair-link-token", { method: "POST" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });

  it("keeps Plaid disabled for authenticated users", async () => {
    authMock.getAuthenticatedSupabaseContext.mockResolvedValue({ user: { id: "user-a" }, supabase: {} });
    const { POST } = await import("./route");
    const response = await POST(new Request("http://localhost/api/plaid/create-bilt-repair-link-token", { method: "POST" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Plaid integration is currently disabled." });
  });
});
