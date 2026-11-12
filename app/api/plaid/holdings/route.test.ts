import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), prepare: vi.fn(), verify: vi.fn(), sync: vi.fn() }));
vi.mock("../../../../lib/plaidTenant", () => ({ getAuthenticatedPlaidContext: mocks.auth }));
vi.mock("../../../../lib/plaidHoldings", () => ({ prepareHoldingsConsent: mocks.prepare, verifyHoldingsConsent: mocks.verify, syncItemHoldings: mocks.sync, holdingsFailure: () => ({ message: "Holdings unavailable" }) }));
vi.mock("../../../../lib/plaidOperations", async (original) => ({ ...await original<typeof import("../../../../lib/plaidOperations")>(), withPlaidOperation: async (_context: unknown, work: () => Promise<unknown>) => work() }));
import { GET, POST } from "./route";
import { POST as consent } from "../create-investment-update-link-token/route";
const req = (body: unknown, origin?: string) => new Request("https://fixture.invalid/api/plaid/holdings", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: "verified-owner", supabase: {} }); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://fixture.invalid"); });
afterEach(() => vi.unstubAllEnvs());
it("requires authentication, same-origin mutations and an explicit sync approval", async () => {
  mocks.auth.mockResolvedValueOnce(null); expect((await POST(req({ action: "sync", approved: true, connection_id: "connection" }))).status).toBe(401);
  expect((await POST(req({ action: "sync", approved: true, connection_id: "connection" }, "https://attacker.invalid"))).status).toBe(403);
  expect((await POST(req({ action: "sync", connection_id: "connection" }))).status).toBe(400);
  expect((await POST(req({ action: "sync", approved: true, connection_id: "connection", user_id: "victim" }))).status).toBe(400);
  expect(mocks.sync).not.toHaveBeenCalled();
});
it("dispatches consent and holdings sync separately using the verified owner context", async () => {
  mocks.sync.mockResolvedValue({ success: true }); mocks.verify.mockResolvedValue({ authorized: false }); mocks.prepare.mockResolvedValue({ mode: "update" });
  expect((await consent(req({ connection_id: "connection", mode: "update" }))).status).toBe(200);
  expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ userId: "verified-owner" }), "connection", false);
  expect(mocks.sync).not.toHaveBeenCalled();
  expect((await POST(req({ action: "verify", credential_session: "encrypted-session" }))).status).toBe(200); expect(mocks.sync).not.toHaveBeenCalled();
  expect((await POST(req({ action: "sync", connection_id: "connection", approved: true }))).status).toBe(200);
  expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ userId: "verified-owner" }), "connection");
});
it("returns stored owner-scoped status without provider identifiers, tokens, or provider calls", async () => {
  const filters: unknown[][] = [];
  const from = vi.fn((table: string) => {
    const result = { count: 1, error: null, data: table === "plaid_items" ? [{ id: "internal-connection", plaid_item_id: "PRIVATE-PROVIDER-ITEM", institution_name: "Robinhood", connection_status: "active", products: ["transactions"] }] : [{ id: "internal-account", plaid_item_id: "PRIVATE-PROVIDER-ITEM", account_type: "investment", account_name: "Robinhood Roth IRA", holdings_status: "not_synced", holdings_synced_at: null }] };
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn((...args) => { filters.push(args); return query; }), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue(result) }; return query;
  });
  mocks.auth.mockResolvedValue({ userId: "verified-owner", supabase: { from } });
  const response = await GET(new Request("https://fixture.invalid/api/plaid/holdings"));
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const text = await response.text(); expect(text).toContain("Robinhood Roth IRA"); expect(text).not.toMatch(/PRIVATE-PROVIDER|access_token|credential_id/);
  expect(filters).toEqual([["user_id", "verified-owner"], ["user_id", "verified-owner"]]); expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.sync).not.toHaveBeenCalled();
});
