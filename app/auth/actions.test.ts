import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  ensureOwnProfile: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("../../lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
  ensureOwnProfile: mocks.ensureOwnProfile,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { signOut, signUp } from "./actions";

describe("fresh account profile initialization", () => {
  it("initializes only the new authenticated profile after a successful signup", async () => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    const register = vi.fn().mockResolvedValue({ data: { user: { id: "new-auth-user" }, session: {} }, error: null });
    const client = { auth: { signUp: register } };
    mocks.createSupabaseServerClient.mockResolvedValue(client);
    const form = new FormData(); form.set("email", "synthetic@example.test"); form.set("password", "synthetic-password");
    try {
      await expect(signUp(form)).rejects.toThrow("redirect:/onboarding");
      expect(mocks.ensureOwnProfile).toHaveBeenCalledWith(client, "new-auth-user");
      expect(register).toHaveBeenCalledWith(expect.objectContaining({ options: { emailRedirectTo: "http://localhost:3000/auth/callback" } }));
    } finally { vi.unstubAllEnvs(); }
  });
});

describe("signOut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it("redirects to login after successful sign-out", async () => {
    const signOutRequest = vi.fn().mockResolvedValue({ error: null });
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { signOut: signOutRequest } });

    await expect(signOut()).rejects.toThrow("redirect:/login");

    expect(signOutRequest).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });

  it("does not report successful logout when Supabase sign-out fails", async () => {
    const signOutRequest = vi.fn().mockResolvedValue({ error: { message: "private provider detail" } });
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { signOut: signOutRequest } });

    await expect(signOut()).rejects.toThrow("redirect:/login?error=signout");

    expect(signOutRequest).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/login?error=signout");
    expect(mocks.redirect.mock.calls.flat().join(" ")).not.toContain("private provider detail");
    expect(mocks.redirect).not.toHaveBeenCalledWith("/login");
  });

  it("uses the same safe failure path when the sign-out request throws", async () => {
    const signOutRequest = vi.fn().mockRejectedValue(new Error("private network detail"));
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { signOut: signOutRequest } });

    await expect(signOut()).rejects.toThrow("redirect:/login?error=signout");

    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalledWith("/login");
    expect(mocks.redirect.mock.calls.flat().join(" ")).not.toContain("private network detail");
  });
});
