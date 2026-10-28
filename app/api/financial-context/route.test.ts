import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ getAuthenticatedSupabaseContext: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => authMock);

describe("financial context authorization", () => {
  beforeEach(() => authMock.getAuthenticatedSupabaseContext.mockReset());

  it("rejects an absent or invalid bearer before loading data", async () => {
    authMock.getAuthenticatedSupabaseContext.mockResolvedValue(null);
    const { GET } = await import("./route");
    const request = new Request("http://localhost/api/financial-context");
    const response = await GET(request as never);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });
});
