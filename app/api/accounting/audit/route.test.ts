import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ getAuthenticatedSupabaseContext: vi.fn() }));
vi.mock("../../../../lib/supabase/server", () => authMock);

describe("accounting audit authorization", () => {
  beforeEach(() => authMock.getAuthenticatedSupabaseContext.mockReset());

  it("rejects unauthenticated requests before querying financial records", async () => {
    authMock.getAuthenticatedSupabaseContext.mockResolvedValue(null);
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/accounting/audit"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentication required" });
  });

  it("loads account currency for currency-safe audit totals", async () => {
    const rows: Record<string, unknown[]> = {
      accounts: [{
        id: "account-1",
        institution_name: "Example Bank",
        account_name: "Checking",
        account_type: "depository",
        account_subtype: "checking",
        current_balance: 100,
        available_balance: 90,
        currency: "EUR",
        plaid_account_id: "plaid-account-1",
        mask: "1234",
      }],
      transactions: [],
    };
    const supabase = {
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          gte: () => builder,
          lte: () => builder,
          order: () => builder,
          then: (resolve: (result: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: rows[table] ?? [], error: null })),
        };
        return builder;
      },
    };
    authMock.getAuthenticatedSupabaseContext.mockResolvedValue({ user: { id: "user-1" }, supabase });

    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/accounting/audit"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.account_summary.accounts[0].currency).toBe("EUR");
    expect(body.monthly_accounting.currency).toBeNull();
    expect(body.monthly_accounting.currency_safe).toBe(true);
  });
});
