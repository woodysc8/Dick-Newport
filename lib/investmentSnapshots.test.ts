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
});