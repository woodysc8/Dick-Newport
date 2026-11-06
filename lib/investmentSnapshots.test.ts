import { describe, expect, it } from "vitest";
import { calculateSecuritiesOnlyValue, isCashEquivalentAsset } from "./investmentSnapshots";

describe("calculateSecuritiesOnlyValue", () => {
  it("excludes CUR:USD and includes actual securities", () => {
    expect(calculateSecuritiesOnlyValue([
      { tickerSymbol: "CUR:USD", securityName: "CUR:USD", currency: "USD", value: 4398.14 },
      { tickerSymbol: "VOO", securityName: "Vanguard S&P 500 ETF", currency: "USD", value: 9985 },
    ])).toBe(9985);
  });

  it("recognizes currency assets without treating ordinary USD securities as cash", () => {
    expect(isCashEquivalentAsset({ securityName: "CUR:USD", currency: "USD", value: 10 })).toBe(true);
    expect(isCashEquivalentAsset({ securityName: "Vanguard S&P 500 ETF", currency: "USD", value: 10 })).toBe(false);
  });

  it("sums securities only when every value has the same known currency", () => {
    expect(calculateSecuritiesOnlyValue([
      { securityName: "Fund A", currency: "USD", value: 100 },
      { securityName: "Fund B", currency: "USD", value: 25 },
    ])).toBe(125);
  });

  it("returns null for mixed, unknown, or absent securities values", () => {
    expect(calculateSecuritiesOnlyValue([
      { securityName: "Fund A", currency: "USD", value: 100 },
      { securityName: "Fund B", currency: "EUR", value: 25 },
    ])).toBeNull();
    expect(calculateSecuritiesOnlyValue([
      { securityName: "Fund A", currency: null, value: 100 },
    ])).toBeNull();
    expect(calculateSecuritiesOnlyValue([
      { securityName: "CUR:USD", currency: "USD", value: 100 },
    ])).toBeNull();
  });
});