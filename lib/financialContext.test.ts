import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFinancialContext } from "./financialContext";

describe("financial context currency propagation", () => {
  it("preserves connected account and holding currencies", async () => {
    const rows: Record<string, unknown[]> = {
      accounts: [{
        institution_name: "Example Bank",
        account_name: "Checking",
        mask: "1234",
        account_type: "depository",
        account_subtype: "checking",
        current_balance: 100,
        available_balance: 90,
        currency: "EUR",
        plaid_account_id: "account-1",
        plaid_item_id: "item-1",
      }],
      transactions: [],
      investment_holdings: [{
        id: "holding-1",
        plaid_account_id: "account-1",
        security_id: "security-1",
        ticker_symbol: "ABC",
        security_name: "Example Fund",
        quantity: 1,
        institution_price: 100,
        institution_value: 100,
        cost_basis: 80,
        currency: "EUR",
        iso_currency_code: "EUR",
      }],
    };

    const supabase = {
      from(table: string) {
        const builder = {
          select: () => builder,
          eq: () => builder,
          gte: () => builder,
          lte: () => builder,
          order: () => builder,
          limit: () => builder,
          then: (resolve: (result: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: rows[table] ?? [], error: null })),
        };
        return builder;
      },
    } as unknown as SupabaseClient;

    const context = await getFinancialContext(supabase, "user-1");

    expect(context.accounts[0].currency).toBe("EUR");
    expect(context.investments.holdings[0].currency).toBe("EUR");
    expect(context.netWorth.total).toBe(100);
  });
});
