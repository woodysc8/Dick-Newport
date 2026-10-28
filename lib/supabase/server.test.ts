import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: authMocks.createClient }));
vi.mock("@supabase/ssr", () => ({ createServerClient: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { ensureOwnProfile, getAuthenticatedSupabaseContext } from "./server";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

describe("profile ownership initialization", () => {
  it("initializes each profile with only its authenticated owner ID", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: vi.fn(() => ({ upsert })) };

    await ensureOwnProfile(client as never, "auth-user-a");
    await ensureOwnProfile(client as never, "auth-user-b");

    expect(client.from).toHaveBeenCalledWith("profiles");
    expect(upsert.mock.calls.map(([values]) => values)).toEqual([{ id: "auth-user-a" }, { id: "auth-user-b" }]);
    expect(upsert).toHaveBeenCalledWith(expect.any(Object), { onConflict: "id", ignoreDuplicates: true });
  });
});

describe("authenticated Supabase context", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
    authMocks.createClient.mockReset();
    authMocks.getUser.mockReset();
    authMocks.createClient.mockReturnValue({ auth: { getUser: authMocks.getUser } });
  });

  afterAll(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalKey;
  });

  it("returns only the user verified from the bearer token", async () => {
    const user = { id: "auth-user-a" };
    authMocks.getUser.mockResolvedValue({ data: { user }, error: null });
    const request = new Request("http://localhost/api/private", { headers: { authorization: "Bearer user-token" } });

    const result = await getAuthenticatedSupabaseContext(request);

    expect(result?.user).toEqual(user);
    expect(authMocks.getUser).toHaveBeenCalledWith("user-token");
    expect(authMocks.createClient.mock.calls[0][1]).toBe("publishable-test-key");
    expect(JSON.stringify(authMocks.createClient.mock.calls)).not.toContain("service_role");
  });

  it("rejects invalid tokens and requires a bearer for bearer-only routes", async () => {
    authMocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid" } });
    const invalid = await getAuthenticatedSupabaseContext(new Request("http://localhost", { headers: { authorization: "Bearer expired" } }));
    const absent = await getAuthenticatedSupabaseContext(new Request("http://localhost"), { requireBearer: true });
    expect(invalid).toBeNull();
    expect(absent).toBeNull();
  });
});
