import { describe, expect, it } from "vitest";
import { DashboardAccount, getDashboardAccountClass } from "./dashboard";

function account(account_type: string, account_subtype: string): DashboardAccount {
  return {
    id: "account-id",
    institution_name: "Test institution",
    account_name: "Test account",
    mask: null,
    account_type,
    account_subtype,
    current_balance: 0,
    available_balance: 0,
  };
}

describe("getDashboardAccountClass", () => {
  it("classifies Plaid's roth investment subtype as retirement", () => {
    expect(getDashboardAccountClass(account("investment", "roth"))).toBe("retirement");
  });

  it("keeps brokerage accounts as investments", () => {
    expect(getDashboardAccountClass(account("investment", "brokerage"))).toBe("investment");
  });

  it("keeps ordinary investment accounts as investments", () => {
    expect(getDashboardAccountClass(account("investment", ""))).toBe("investment");
  });
});
