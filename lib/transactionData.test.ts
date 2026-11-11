import type { SupabaseClient } from "@supabase/supabase-js";
import { expect, it, vi } from "vitest";
import {
  listTransactions,
  loadWeeklyBudget,
  transactionFilters,
} from "./transactionData";

it.each([
  "page=0",
  "page=1001",
  "page=1.5",
  "account=not-uuid",
  "category=bad",
  "status=anything",
  "start=2026-02-30",
  "start=2026-12-01&end=2026-01-01",
])("rejects unsafe filters: %s", (query) =>
  expect(() => transactionFilters(new URLSearchParams(query))).toThrow(),
);
it("bounds and sanitizes search without interpolating PostgREST controls", () => {
  expect(
    transactionFilters(new URLSearchParams("q=Coffee%2Camount.gt.0%29")).q,
  ).toBe("Coffee amount gt 0");
  expect(() =>
    transactionFilters(new URLSearchParams({ q: "x".repeat(101) })),
  ).toThrow();
});
it("scopes filtered pagination to the authenticated owner and returns at most 50 rows", async () => {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const name of ["select", "eq", "or", "gte", "lte", "order"])
    query[name] = vi.fn(() => query);
  query.range = vi.fn(async () => ({
    data: Array.from({ length: 51 }, (_, id) => ({ id })),
    error: null,
  }));
  const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;
  const result = await listTransactions(
    client,
    "user-a",
    new URLSearchParams(
      "page=2&q=Coffee&category=coffee&status=posted&start=2026-11-01&end=2026-11-11",
    ),
  );
  expect(query.eq).toHaveBeenCalledWith("user_id", "user-a");
  expect(query.eq).toHaveBeenCalledWith("pending", false);
  expect(query.range).toHaveBeenCalledWith(50, 100);
  expect(query.order).toHaveBeenCalledWith("date", { ascending: false });
  expect(query.or).toHaveBeenCalledWith(
    "category_override.eq.coffee,and(category_override.is.null,normalized_category.eq.coffee)",
  );
  expect(result.transactions).toHaveLength(50);
  expect(result.hasMore).toBe(true);
});
it.each([
  { data: null, error: { message: "private-database" } },
  {
    data: { user_id: "another-user", accounts: [], transactions: [] },
    error: null,
  },
])("fails closed on snapshot errors or a wrong owner", async (result) => {
  const rpc = vi.fn().mockResolvedValue(result);
  await expect(
    loadWeeklyBudget({ rpc } as unknown as SupabaseClient, "user-a"),
  ).rejects.toThrow("Weekly snapshot unavailable");
});
it.each([
  [{ sync_in_progress: true }, "still being imported"],
  [
    { transactions: Array.from({ length: 10001 }, () => ({})) },
    "supported volume",
  ],
])(
  "never displays an in-progress or truncated total",
  async (overrides, message) => {
    const rpc = vi
      .fn()
      .mockResolvedValue({
        data: {
          user_id: "user-a",
          accounts: [],
          transactions: [],
          weekly_limit: null,
          ...overrides,
        },
        error: null,
      });
    await expect(
      loadWeeklyBudget({ rpc } as unknown as SupabaseClient, "user-a"),
    ).rejects.toThrow(String(message));
  },
);
