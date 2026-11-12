import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadMonthlyActivity } from "./transactionData";
import type { BudgetAccount, BudgetTransaction } from "./discretionaryBudget";

const account = { id: "00000000-0000-4000-8000-000000000001", account_name: "Checking", institution_name: "Fixture", currency: "USD", persistent_account_id: null, weekly_budget_source: "exclude", created_at: "2026-01-01", account_type: "depository", user_id: "owner" } satisfies BudgetAccount & { user_id: string };
const row = { id: "t", user_id: "owner", account_id: account.id, plaid_transaction_id: "private-provider", date: "2026-11-12", name: "Fixture", merchant_name: null, amount: 1, pending: false, category: null, normalized_category: "needs_review", category_override: null, weekly_budget_override: null, transaction_currency: "USD", pending_transaction_id: null, plaid_primary_category: null, plaid_detailed_category: null, plaid_category_confidence: null } satisfies BudgetTransaction & { user_id: string };
type SavedRow = BudgetTransaction & { user_id: string };
function database(rows: SavedRow[], options: { cap?: number; error?: boolean } = {}) {
  const mutations = vi.fn(() => { throw new Error("Unexpected write"); });
  const calls: { table: string; eq: ReturnType<typeof vi.fn>; range: ReturnType<typeof vi.fn>; inside: ReturnType<typeof vi.fn> }[] = [];
  const from = vi.fn((table: string) => {
    const filters: ((r: Record<string, unknown>) => boolean)[] = [];
    const orders: [string, boolean][] = [];
    const read = async (start: number, end: number) => {
      const records = (table === "accounts" ? [account] : rows) as unknown as Record<string, unknown>[];
      const all = records.filter((r) => filters.every((f) => f(r))).sort((a, b) => {
        for (const [key, asc] of orders) { const compare = String(a[key]).localeCompare(String(b[key])); if (compare) return asc ? compare : -compare; }
        return 0;
      });
      return { data: all.slice(start, Math.min(end + 1, start + (options.cap ?? Infinity))), count: all.length, error: options.error ? { message: "private DB details" } : null };
    };
    const q = {
      select: vi.fn(() => q),
      eq: vi.fn((key: string, value: unknown) => { filters.push((r) => r[key] === value); return q; }),
      gte: vi.fn((key: string, value: string) => { filters.push((r) => String(r[key]) >= value); return q; }),
      lt: vi.fn((key: string, value: string) => { filters.push((r) => String(r[key]) < value); return q; }),
      in: vi.fn((key: string, values: unknown[]) => { filters.push((r) => values.includes(r[key])); return q; }),
      order: vi.fn((key: string, order: { ascending?: boolean } = {}) => { orders.push([key, order.ascending !== false]); return q; }),
      range: vi.fn(read), limit: vi.fn((size: number) => read(0, size - 1)),
      update: mutations, insert: mutations, delete: mutations, upsert: mutations,
    };
    calls.push({ table, eq: q.eq, range: q.range, inside: q.in });
    return q;
  });
  return { client: { from } as unknown as SupabaseClient, calls, mutations };
}

it("returns monthly totals across pages with owner scoping and no writes or provider identifiers", async () => {
  const rows = Array.from({ length: 61 }, (_, i) => ({ ...row, id: `row-${String(i).padStart(3, "0")}`, plaid_transaction_id: `private-${i}` }));
  const db = database([...rows, { ...row, id: "other-owner-secret", user_id: "other" }, { ...row, id: "prior-month", date: "2026-10-01" }]);
  const first = await loadMonthlyActivity(db.client, "owner", new URLSearchParams("month=2026-11&user_id=other"));
  expect(first.postedPurchases).toBe(61);
  expect(first.totalTransactions).toBe(61);
  expect(first.rows).toHaveLength(50);
  expect(first.rows[0].id).toBe("row-060");
  expect(first.hasMore).toBe(true);
  const second = await loadMonthlyActivity(db.client, "owner", new URLSearchParams("month=2026-11&page=2"));
  expect(second.rows).toHaveLength(11);
  expect(second.postedPurchases).toBe(61);
  expect(second.hasMore).toBe(false);
  for (const call of db.calls) expect(call.eq).toHaveBeenCalledWith("user_id", "owner");
  expect(JSON.stringify(first)).not.toContain("private-");
  expect(JSON.stringify(first)).not.toContain("other-owner-secret");
  expect(db.mutations).not.toHaveBeenCalled();
});

it("resolves later-month postings only within the authenticated owner", async () => {
  const pending: SavedRow = { ...row, id: "pending", plaid_transaction_id: "pending-id", pending: true, date: "2026-11-30" };
  const posted: SavedRow = { ...row, id: "posted", plaid_transaction_id: "posted-id", pending_transaction_id: "pending-id", date: "2026-12-01" };
  const db = database([pending, posted]);
  const result = await loadMonthlyActivity(db.client, "owner", new URLSearchParams("month=2026-11"));
  expect(result.totalTransactions).toBe(0);
  expect(result.pendingPurchases).toBe(0);
  expect(db.calls.at(-1)!.inside).toHaveBeenCalledWith("pending_transaction_id", ["pending-id"]);
  expect(db.calls.at(-1)!.eq).toHaveBeenCalledWith("user_id", "owner");
  const other = database([pending, { ...posted, user_id: "other" }]);
  expect((await loadMonthlyActivity(other.client, "owner", new URLSearchParams("month=2026-11"))).totalTransactions).toBe(1);
});

it("defaults the calendar month using America/New_York rather than UTC", async () => {
  const db = database([]);
  const result = await loadMonthlyActivity(db.client, "owner", new URLSearchParams(), new Date("2026-12-01T01:00:00Z"));
  expect(result.month).toBe("2026-11");
  expect(result.postedPurchases).toBe(0);
});

it.each(["month=2026-13", "month=bad", "page=0", "page=201", "account=bad"])("rejects invalid monthly filters: %s", async (q) => {
  const db = database([]);
  await expect(loadMonthlyActivity(db.client, "owner", new URLSearchParams(q))).rejects.toThrow();
  expect(db.calls).toHaveLength(0);
});

it("rejects inaccessible account filters and truncated/error/over-limit reads", async () => {
  const db = database([row]);
  await expect(loadMonthlyActivity(db.client, "owner", new URLSearchParams("month=2026-11&account=00000000-0000-4000-8000-000000000099"))).rejects.toThrow("Account unavailable");
  const truncated = database([{ ...row, id: "a" }, { ...row, id: "b" }], { cap: 1 });
  await expect(loadMonthlyActivity(truncated.client, "owner", new URLSearchParams("month=2026-11"))).rejects.toThrow("coverage incomplete");
  await expect(loadMonthlyActivity(database([], { error: true }).client, "owner", new URLSearchParams("month=2026-11"))).rejects.toThrow();
  const large = database(Array.from({ length: 10001 }, (_, i) => ({ ...row, id: String(i) })));
  await expect(loadMonthlyActivity(large.client, "owner", new URLSearchParams("month=2026-11"))).rejects.toThrow("no partial spending total");
});
