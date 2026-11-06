import { Configuration, CountryCode, PlaidApi, Products } from "plaid";

export type PlaidEnvironment = "sandbox" | "production";

function plaidEnvironment(): PlaidEnvironment {
  const value = process.env.PLAID_ENV;
  if (value !== "sandbox" && value !== "production") {
    throw new Error("Plaid environment is not configured");
  }
  return value;
}

function plaidCredentials() {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) throw new Error("Plaid credentials are not configured");
  return { clientId, secret };
}

export function createPlaidClient() {
  const environment = plaidEnvironment();
  const { clientId, secret } = plaidCredentials();
  return new PlaidApi(new Configuration({
    basePath: environment === "production"
      ? "https://production.plaid.com"
      : "https://sandbox.plaid.com",
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  }));
}

export function createLinkTokenRequest(userId: string) {
  return {
    client_name: "Dick-Newport",
    language: "en",
    country_codes: [CountryCode.Us],
    user: { client_user_id: userId },
    products: [Products.Transactions],
  };
}
