import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAuthenticatedSupabaseContext: vi.fn(), getFinancialContext: vi.fn() }));

vi.mock("../../../lib/supabase/server", () => ({ getAuthenticatedSupabaseContext: mocks.getAuthenticatedSupabaseContext }));
vi.mock("../../../lib/financialContext", () => ({ getFinancialContext: mocks.getFinancialContext }));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

describe("financial MCP authorization", () => {
  beforeEach(() => {
    mocks.getAuthenticatedSupabaseContext.mockReset();
    mocks.getFinancialContext.mockReset();
  });

  it("rejects unauthenticated MCP methods before reading personal data", async () => {
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue(null);
    const post = await POST(new NextRequest("http://untrusted.example/api/mcp", {
      method: "POST", headers: { authorization: "Bearer invalid", "content-type": "application/json" }, body: "{}",
    }));
    const get = await GET(new NextRequest("http://untrusted.example/api/mcp", { headers: { authorization: "Bearer invalid" } }));
    expect(post.status).toBe(401);
    expect(get.status).toBe(401);
    expect(mocks.getFinancialContext).not.toHaveBeenCalled();
  });

  it("loads MCP data directly with the verified user's session client", async () => {
    const supabase = { marker: "session-client" };
    const user = { id: "verified-owner" };
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue({ supabase, user });
    mocks.getFinancialContext.mockResolvedValue({ generatedAt: "test", netWorth: { total: 0, cash: 0, creditCardDebt: 0, investments: 0 }, accounts: [], investments: { totalValue: 0, holdings: [] }, monthly: { income: 0, grossSpending: 0, netPersonalSpending: 0, refunds: 0, transfers: 0, creditCardPayments: 0, categories: {} }, recentTransactions: [], rewards: {}, freshness: {} });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      const response = await POST(new NextRequest("http://untrusted.example/api/mcp", {
        method: "POST",
        headers: { authorization: "Bearer valid-test-token", "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_net_worth", arguments: {} } }),
      }));
      expect(response.status).toBe(200);
      expect(mocks.getFinancialContext).toHaveBeenCalledWith(supabase, user.id, { scope: "networth" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
