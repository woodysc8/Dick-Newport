import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  profile: vi.fn(),
  list: vi.fn(),
  accounts: vi.fn(),
  weekly: vi.fn(),
  policy: vi.fn(),
  suggestions: vi.fn(),
  monthly: vi.fn(),
}));
vi.mock("../../../lib/supabase/server", () => ({
  getAuthenticatedSupabaseContext: mocks.auth,
  ensureOwnProfile: mocks.profile,
}));
vi.mock("../../../lib/transactionData", async (original) => ({
  ...(await original<typeof import("../../../lib/transactionData")>()),
  listTransactions: mocks.list,
  listAccounts: mocks.accounts,
  loadWeeklyBudget: mocks.weekly,
  listTransactionSuggestions: mocks.suggestions,
  loadMonthlyActivity: mocks.monthly,
}));
vi.mock("../../../lib/financialBudgetData", () => ({ loadBudgetPolicy: mocks.policy }));
import { GET, PATCH } from "./route";
import {
  GET as weeklyGET,
  PUT,
  PATCH as sourcePATCH,
} from "../weekly-budget/route";
const id = "00000000-0000-4000-8000-000000000001";
const chain = {
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
};
const client = { from: vi.fn(() => chain) };
function request(method: string, body?: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/transactions?user_id=other", {
    method,
    headers: { origin, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_SITE_URL;
  mocks.auth.mockResolvedValue({ supabase: client, user: { id: "owner" } });
  for (const name of ["update", "eq", "select"] as const)
    chain[name].mockReturnValue(chain);
  chain.maybeSingle.mockResolvedValue({ data: { id }, error: null });
  chain.upsert.mockResolvedValue({ error: null });
  mocks.list.mockResolvedValue({ transactions: [], hasMore: false, page: 1 });
  mocks.accounts.mockResolvedValue([]);
  mocks.weekly.mockResolvedValue({});
  mocks.policy.mockResolvedValue({ categories: [], accounts: [], monthly_limit: null });
  mocks.suggestions.mockResolvedValue({ suggestions: [], summary: { total: 0 }, page: 1, hasMore: false });
  mocks.monthly.mockResolvedValue({ rows: [], totalTransactions: 0, page: 1, hasMore: false });
});
it("authenticates monthly history, uses only the verified owner, and does not load budget policy or write", async () => {
  const req = () => new Request("http://localhost/api/transactions?view=monthly&month=2026-11&user_id=other");
  mocks.auth.mockResolvedValueOnce(null);
  expect((await GET(req())).status).toBe(401);
  expect(mocks.monthly).not.toHaveBeenCalled();
  const response = await GET(req());
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.monthly).toHaveBeenCalledWith(client, "owner", expect.any(URLSearchParams));
  expect(mocks.policy).not.toHaveBeenCalled();
  expect(mocks.profile).not.toHaveBeenCalled();
  expect(chain.update).not.toHaveBeenCalled();
  expect(chain.upsert).not.toHaveBeenCalled();
});
it("authenticates the suggestion preview and ignores forged owner identifiers without any writes", async () => {
  const req = () => new Request("http://localhost/api/transactions?view=suggestions&user_id=other");
  mocks.auth.mockResolvedValueOnce(null);
  expect((await GET(req())).status).toBe(401);
  expect(mocks.suggestions).not.toHaveBeenCalled();
  expect((await GET(req())).status).toBe(200);
  expect(mocks.suggestions).toHaveBeenCalledWith(client, "owner", expect.any(URLSearchParams), [], { categories: [], accounts: [], monthly_limit: null });
  expect(mocks.list).not.toHaveBeenCalled();
  expect(mocks.profile).not.toHaveBeenCalled();
  expect(chain.update).not.toHaveBeenCalled();
  expect(chain.upsert).not.toHaveBeenCalled();
});
it("does not convert preview storage errors into empty successful suggestions", async () => {
  mocks.suggestions.mockRejectedValueOnce(new Error("private DB error"));
  const response = await GET(new Request("http://localhost/api/transactions?view=suggestions"));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private DB error");
});
it("authenticates every read and write without a service role", async () => {
  mocks.auth.mockResolvedValue(null);
  for (const handler of [GET, PATCH, weeklyGET, PUT, sourcePATCH])
    expect(
      (
        await handler(
          request(
            handler === GET || handler === weeklyGET ? "GET" : "PATCH",
            handler === GET || handler === weeklyGET ? undefined : {},
          ),
        )
      ).status,
    ).toBe(401);
  expect(client.from).not.toHaveBeenCalled();
});
it("scopes reads to verified owner, ignoring query user IDs", async () => {
  expect((await GET(request("GET"))).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith(
    client,
    "owner",
    expect.any(URLSearchParams),
  );
  expect(mocks.accounts).toHaveBeenCalledWith(client, "owner");
});
it("checks origin and body size before writes", async () => {
  expect(
    (
      await PATCH(
        request(
          "PATCH",
          { id, category_override: "dining" },
          "https://attacker.example",
        ),
      )
    ).status,
  ).toBe(403);
  expect(
    (await PATCH(request("PATCH", { id, category_override: "x".repeat(5000) })))
      .status,
  ).toBe(400);
  expect(client.from).not.toHaveBeenCalled();
});
it("updates only user-owned override columns", async () => {
  expect(
    (
      await PATCH(
        request("PATCH", {
          id,
          category_override: "coffee",
          weekly_budget_override: "exclude",
        }),
      )
    ).status,
  ).toBe(200);
  expect(chain.update).toHaveBeenCalledWith({
    category_override: "coffee",
    weekly_budget_override: "exclude",
  });
  expect(chain.eq).toHaveBeenCalledWith("user_id", "owner");
  expect(chain.eq).toHaveBeenCalledWith("id", id);
});
it.each([
  { id, category_override: "anything" },
  { id, user_id: "other", category_override: "coffee" },
  { id, amount: 0 },
  { id, weekly_budget_override: "bad" },
  { id, weekly_budget_override: ["include"] },
  { id, monthly_budget_override: ["include"] },
])("rejects provider fields and invalid overrides", async (body) =>
  expect((await PATCH(request("PATCH", body))).status).toBe(400),
);
it("does not report successful edits of another user's transaction or account", async () => {
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });
  expect(
    (await PATCH(request("PATCH", { id, category_override: "coffee" }))).status,
  ).toBe(400);
  expect(
    (await sourcePATCH(request("PATCH", { account_id: id, source: "include" })))
      .status,
  ).toBe(400);
});
it.each([0, 100.12, null])(
  "saves an independent weekly limit %s",
  async (limit) => {
    expect((await PUT(request("PUT", { weekly_limit: limit }))).status).toBe(
      200,
    );
    expect(client.from).toHaveBeenCalledWith("user_weekly_budgets");
    expect(chain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "owner", weekly_limit: limit }),
      { onConflict: "user_id" },
    );
  },
);
it.each([-1, 1.234, "100", 100000001])(
  "rejects invalid limits %s",
  async (limit) =>
    expect((await PUT(request("PUT", { weekly_limit: limit }))).status).toBe(
      400,
    ),
);
it("sanitizes storage failures and returns no-cache JSON", async () => {
  mocks.list.mockRejectedValue(new Error("private database credentials"));
  const result = await GET(request("GET"));
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("private database");
  expect(result.headers.get("Cache-Control")).toBe("no-store");
});
