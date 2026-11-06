import { beforeEach, describe, expect, it, vi } from "vitest";

const plaidMocks = vi.hoisted(() => ({
  Configuration: vi.fn(),
  PlaidApi: vi.fn(),
}));

vi.mock("plaid", () => ({
  Configuration: plaidMocks.Configuration,
  PlaidApi: plaidMocks.PlaidApi,
  CountryCode: { Us: "US" },
  Products: { Transactions: "transactions" },
}));

import { createLinkTokenRequest, createPlaidClient } from "./plaidClient";

describe("Plaid client configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLAID_ENV = "sandbox";
    process.env.PLAID_CLIENT_ID = "client-id";
    process.env.PLAID_SECRET = "client-secret";
    plaidMocks.Configuration.mockImplementation((value) => value);
    plaidMocks.PlaidApi.mockImplementation((value) => ({ configuration: value }));
  });

  it("rejects missing or invalid environment values", () => {
    for (const value of [undefined, "", "staging"]) {
      if (value === undefined) delete process.env.PLAID_ENV;
      else process.env.PLAID_ENV = value;
      expect(() => createPlaidClient()).toThrow("Plaid environment is not configured");
    }
  });

  it("rejects missing credentials", () => {
    delete process.env.PLAID_SECRET;
    expect(() => createPlaidClient()).toThrow("Plaid credentials are not configured");
  });

  it("uses the configured environment endpoint", () => {
    const client = createPlaidClient();

    expect(client).toBeDefined();
    expect(plaidMocks.Configuration).toHaveBeenCalledWith(expect.objectContaining({
      basePath: "https://sandbox.plaid.com",
      baseOptions: { headers: { "PLAID-CLIENT-ID": "client-id", "PLAID-SECRET": "client-secret" } },
    }));
  });

  it("derives Link identity from the supplied server-authenticated ID", () => {
    expect(createLinkTokenRequest("user-a")).toEqual({
      client_name: "Dick-Newport",
      language: "en",
      country_codes: ["US"],
      user: { client_user_id: "user-a" },
      products: ["transactions"],
    });
  });
});
