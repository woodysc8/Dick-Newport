import { beforeEach, describe, expect, it, vi } from "vitest";

// This focused harness exercises the service boundary with an empty Item set.
// Item-level Plaid fixtures are kept at the boundary in production; these tests
// ensure a second caller joins the same run instead of acquiring a second lease.
const state = vi.hoisted(() => ({ profileUpdates: 0 }));

vi.mock("plaid", () => ({
  Configuration: class {},
  PlaidApi: class {},
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      const query: Record<string, unknown> = {
        update: () => {
          if (table === "profiles") state.profileUpdates += 1;
          return query;
        },
        select: () => query,
        eq: () => query,
        or: () => query,
        maybeSingle: async () => table === "profiles"
          ? { data: { id: "fixed-user" }, error: null }
          : { data: null, error: null },
      };
      // Awaiting the Item query resolves it without a separate terminal call.
      query.then = (resolve: (value: unknown) => unknown) => resolve(
        table === "plaid_items" ? { data: [], error: null } : { data: null, error: null }
      );
      return query;
    },
  }),
}));

describe("financial background sync", () => {
  beforeEach(() => {
    state.profileUpdates = 0;
    vi.resetModules();
  });

  it("coalesces overlapping invocations into one leased refresh", async () => {
    const { refreshFinancialData } = await import("./plaidRefresh");
    const [first, second] = await Promise.all([refreshFinancialData(), refreshFinancialData()]);

    expect(first).toEqual({ success: true, status: "completed", items: [] });
    expect(second).toEqual(first);
    // One acquire and one release; there is no second concurrent lease.
    expect(state.profileUpdates).toBe(2);
  });
});
