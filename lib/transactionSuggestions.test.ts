import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listTransactionSuggestions } from "./transactionData";
import { emptyPolicy, financialBudget } from "./budgetEngine";
import type { BudgetAccount, BudgetTransaction } from "./discretionaryBudget";

const account: BudgetAccount = { id: "00000000-0000-4000-8000-000000000001", account_name: "Checking", institution_name: "Fixture", currency: "USD", persistent_account_id: "private-durable", weekly_budget_source: "include", created_at: "2026-01-01", account_type: "depository" };
const row: BudgetTransaction = {
  id: "t", account_id: account.id, plaid_transaction_id: "private-provider-id", date: "2026-11-12", name: "Dinner",
  merchant_name: null, amount: 20, pending: false, category: "Food and Drink > Restaurants", normalized_category: "needs_review",
  category_override: null, weekly_budget_override: null, transaction_currency: "USD", pending_transaction_id: null,
  plaid_primary_category: null, plaid_detailed_category: null, plaid_category_confidence: null,
};
function database(rows: (BudgetTransaction & { user_id?: string })[], failure = false) {
  const mutations = vi.fn(() => { throw new Error("Preview attempted a write"); });
  const queries: { eq: ReturnType<typeof vi.fn>; range: ReturnType<typeof vi.fn> }[] = [];
  const from = vi.fn(() => {
    const filters: [string, unknown][] = [];
    const q = {
      select: vi.fn(() => q),
      eq: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return q; }),
      order: vi.fn(() => q),
      range: vi.fn(async (start: number, end: number) => {
        const filtered = rows.filter((r) => filters.every(([key, value]) => (r as unknown as Record<string, unknown>)[key] === value));
        return { data: failure ? null : filtered.slice(start, end + 1), count: filtered.length, error: failure ? { message: "private DB error" } : null };
      }),
      update: mutations, insert: mutations, delete: mutations, upsert: mutations,
    };
    queries.push(q);
    return q;
  });
  return { client: { from } as unknown as SupabaseClient, queries, from, mutations };
}

it("reads only the authenticated owner's rows and returns paginated suggestions without provider identifiers or writes", async () => {
  const rows = Array.from({ length: 505 }, (_, i) => ({ ...row, id: `t-${i}`, plaid_transaction_id: `provider-${i}`, user_id: "owner" }));
  const db = database([...rows, { ...row, id: "other-secret", user_id: "other" }]);
  const result = await listTransactionSuggestions(db.client, "owner", new URLSearchParams("page=2&user_id=other"), [account], emptyPolicy);
  expect(result.summary).toMatchObject({ total: 505, medium: 505, missingProviderMetadata: 505 });
  expect(result.suggestions).toHaveLength(50);
  expect(result.page).toBe(2);
  expect(result.hasMore).toBe(true);
  expect(result.suggestions[0].transaction.id).toBe("t-50");
  expect(db.queries).toHaveLength(2);
  for (const q of db.queries) expect(q.eq).toHaveBeenCalledWith("user_id", "owner");
  expect(JSON.stringify(result)).not.toContain("other-secret");
  expect(JSON.stringify(result)).not.toContain("private-durable");
  expect(JSON.stringify(result)).not.toContain("plaid_transaction_id");
  expect(db.mutations).not.toHaveBeenCalled();
});

it("filters derived categories/confidence/review on the server while keeping account-scope summary counts", async () => {
  const db = database([
    { ...row, user_id: "owner" },
    { ...row, id: "reviewed", plaid_transaction_id: "reviewed", user_id: "owner", category_override: "housing" },
    { ...row, id: "venmo", plaid_transaction_id: "venmo", user_id: "owner", category: "Transfer > Third Party > Venmo" },
    { ...row, id: "other-account", user_id: "owner", account_id: "different" },
  ]);
  const params = new URLSearchParams({ account: account.id, suggestion_confidence: "medium", proposed_category: "dining", review_status: "unreviewed" });
  const result = await listTransactionSuggestions(db.client, "owner", params, [account], emptyPolicy);
  expect(result.matching).toBe(1);
  expect(result.summary).toMatchObject({ total: 3, alreadyReviewed: 1, medium: 1, ambiguous: 1 });
  expect(result.suggestions[0].transaction.id).toBe("t");
  expect(db.queries[0].eq).toHaveBeenCalledWith("account_id", account.id);
});

it("marks pending replacements and repeated provider records as excluded hypothetical activity without altering totals", async () => {
  const rows = [
    { ...row, id: "pending", plaid_transaction_id: "pending-provider", pending: true, user_id: "owner" },
    { ...row, id: "posted", plaid_transaction_id: "posted-provider", pending_transaction_id: "pending-provider", user_id: "owner" },
    { ...row, id: "duplicate", plaid_transaction_id: "posted-provider", user_id: "owner" },
  ];
  const before = financialBudget(rows, [account], 420);
  const db = database(rows);
  const { suggestions } = await listTransactionSuggestions(db.client, "owner", new URLSearchParams(), [account], emptyPolicy);
  expect(suggestions[0].weekly.kind).toBe("exclude");
  expect(suggestions[1].weekly.kind).toBe("include");
  expect(suggestions[2].weekly.kind).toBe("exclude");
  expect(suggestions[0].monthly.kind).toBe("exclude");
  expect(financialBudget(rows, [account], 420)).toEqual(before);
  expect(rows[1].normalized_category).toBe("needs_review");
  expect(db.mutations).not.toHaveBeenCalled();
});

it("uses shared budget rules for card payments, rent, source safety, and hypothetical credits", async () => {
  const rows = [
    { ...row, id: "card", plaid_transaction_id: "card", user_id: "owner", category: "Payment > Credit Card" },
    { ...row, id: "rent", plaid_transaction_id: "rent", user_id: "owner", category: "Payment > Rent" },
    { ...row, id: "refund", plaid_transaction_id: "refund", user_id: "owner", amount: -5 },
  ];
  const db = database(rows);
  const result = await listTransactionSuggestions(db.client, "owner", new URLSearchParams(), [account], emptyPolicy);
  expect(result.suggestions[0]).toMatchObject({ weekly: { kind: "exclude" }, monthly: { kind: "exclude" } });
  expect(result.suggestions[1]).toMatchObject({ weekly: { kind: "exclude" }, monthly: { kind: "include" } });
  expect(result.suggestions[2].weekly.reason).toContain("explicit approval");
  const excluded = await listTransactionSuggestions(db.client, "owner", new URLSearchParams(), [{ ...account, weekly_budget_source: "exclude" }], emptyPolicy);
  expect(excluded.suggestions[1].monthly.kind).toBe("exclude");
});

it.each(["suggestion_confidence=trusted", "proposed_category=bad", "review_status=approved", "account=not-uuid", "page=0"])("rejects invalid preview filters before transaction reads: %s", async (q) => {
  const db = database([]);
  await expect(listTransactionSuggestions(db.client, "owner", new URLSearchParams(q), [account], emptyPolicy)).rejects.toThrow();
  expect(db.from).not.toHaveBeenCalled();
});

it("fails closed on storage errors and volume limits instead of returning partial counts", async () => {
  const failed = database([], true);
  await expect(listTransactionSuggestions(failed.client, "owner", new URLSearchParams(), [account], emptyPolicy)).rejects.toThrow("Suggestion data unavailable");
  const large = database(Array.from({ length: 10001 }, (_, i) => ({ ...row, id: String(i), user_id: "owner" })));
  await expect(listTransactionSuggestions(large.client, "owner", new URLSearchParams(), [account], emptyPolicy)).rejects.toThrow("supported volume");
  expect(large.mutations).not.toHaveBeenCalled();
});

it("rejects capped reads, unavailable exact counts and shifting pagination instead of reporting partial summaries", async () => {
  for (const results of [
    [{ data: [row], count: 2, error: null }],
    [{ data: [row], count: null, error: null }],
    [{ data: Array.from({ length: 500 }, (_, i) => ({ ...row, id: String(i) })), count: 501, error: null }, { data: [], count: 500, error: null }],
  ]) {
    const q: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "order"]) q[method] = vi.fn(() => q);
    q.range = vi.fn();
    for (const result of results) q.range.mockResolvedValueOnce(result);
    const client = { from: vi.fn(() => q) } as unknown as SupabaseClient;
    await expect(listTransactionSuggestions(client, "owner", new URLSearchParams(), [account], emptyPolicy)).rejects.toThrow(/coverage/);
  }
});
