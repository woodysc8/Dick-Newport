import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ getAuthenticatedSupabaseContext: vi.fn() }));
vi.mock("../../../../lib/supabase/server", () => authMock);

describe("accounting audit authorization", () => {
  beforeEach(() => authMock.getAuthenticatedSupabaseContext.mockReset());

  it("rejects unauthenticated requests before querying financial records", async () => {
    authMock.getAuthenticatedSupabaseContext.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/accounting/audit"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });
});
