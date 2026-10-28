import { describe, expect, it } from "vitest";
import { AccountPurposeMetadata, getAccountPurpose, mapAccountPurposes } from "./accountPurpose";

function account(overrides: Partial<AccountPurposeMetadata> = {}): AccountPurposeMetadata {
  return {
    id: "account-id",
    institution_name: "Test institution",
    account_name: "Test account",
    account_type: "depository",
    account_subtype: "checking",
    ...overrides,
  };
}

describe("getAccountPurpose", () => {
  it("distinguishes Robinhood Roth from taxable brokerage", () => {
    expect(getAccountPurpose(account({ institution_name: "Robinhood", account_name: "Roth IRA", account_type: "investment", account_subtype: "roth" }))).toBe("retirement");
    expect(getAccountPurpose(account({ institution_name: "Robinhood", account_name: "Individual", account_type: "investment", account_subtype: "brokerage" }))).toBe("equities");
  });

  it("maps operating accounts, Venmo, credit, and HYSA semantically", () => {
    expect(getAccountPurpose(account({ institution_name: "USAA", account_name: "Checking" }))).toBe("spending");
    expect(getAccountPurpose(account({ institution_name: "Venmo", account_name: "Venmo balance" }))).toBe("venmo");
    expect(getAccountPurpose(account({ account_type: "credit", account_subtype: "credit card" }))).toBe("credit");
    expect(getAccountPurpose(account({ institution_name: "Bilt", account_type: "depository", account_subtype: "checking" }))).toBe("credit");
    expect(getAccountPurpose(account({ institution_name: "Barclays", account_type: "depository", account_subtype: "checking" }))).toBe("credit");
    expect(getAccountPurpose(account({ institution_name: "Robinhood", account_name: "Bills HYSA", account_type: "depository", account_subtype: "savings" }))).toBe("hysa");
  });

  it("keeps Robinhood Crypto out of equities", () => {
    expect(getAccountPurpose(account({ institution_name: "Robinhood", account_name: "Crypto", account_type: "investment", account_subtype: "crypto" }))).toBe("other");
    expect(getAccountPurpose(account({ institution_name: "Other broker", account_name: "Brokerage", account_type: "investment", account_subtype: "brokerage" }))).toBe("other");
  });

  it("maps real account IDs without using them for classification", () => {
    const purposes = mapAccountPurposes([
      account({ id: "roth-id", account_name: "Roth IRA", account_subtype: "roth" }),
      account({ id: "cash-id", institution_name: "USAA" }),
    ]);

    expect([...purposes.entries()]).toEqual([
      ["roth-id", "retirement"],
      ["cash-id", "spending"],
    ]);
  });
});