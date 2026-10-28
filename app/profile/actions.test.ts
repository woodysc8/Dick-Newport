import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSupabaseContext: vi.fn(),
  ensureOwnProfile: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  ownerFilter: vi.fn(),
}));

vi.mock("../../lib/supabase/server", () => ({
  getAuthenticatedSupabaseContext: mocks.getAuthenticatedSupabaseContext,
  ensureOwnProfile: mocks.ensureOwnProfile,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { saveFinancialProfile } from "./actions";

function client() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { financial_profile: null }, error: null });
  const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) });
  const profileWriteEq = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: "user-real" }, error: null }) }) });
  const update = vi.fn().mockReturnValue({ eq: profileWriteEq });
  const from = vi.fn((table: string) => table === "profiles" ? { select, update } : {});
  return { supabase: { from }, profileWriteEq, update };
}

describe("save financial profile server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it("requires a verified user and writes using that user's id, ignoring any submitted owner id", async () => {
    const { supabase, profileWriteEq } = client();
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue({ user: { id: "user-real" }, supabase });
    const form = new FormData();
    form.set("user_id", "attacker-selected-id");
    await expect(saveFinancialProfile({ errors: {} }, form)).rejects.toThrow("redirect:/");
    expect(mocks.ensureOwnProfile).toHaveBeenCalledWith(supabase, "user-real");
    expect(profileWriteEq).toHaveBeenCalledWith("id", "user-real");
  });

  it("redirects unauthenticated calls to sign-in without touching profile data", async () => {
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue(null);
    await expect(saveFinancialProfile({ errors: {} }, new FormData())).rejects.toThrow("redirect:/login");
    expect(mocks.ensureOwnProfile).not.toHaveBeenCalled();
  });

  it("does not persist an invalid intake", async () => {
    const { supabase, update } = client();
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue({ user: { id: "user-real" }, supabase });
    const form = new FormData();
    form.set("incomeAmount", "2500");
    const result = await saveFinancialProfile({ errors: {} }, form);
    expect(result.errors.incomeBasis).toBeDefined();
    expect(update).not.toHaveBeenCalled();
  });
});
