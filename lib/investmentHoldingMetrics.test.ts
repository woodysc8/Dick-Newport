import { expect, it } from "vitest";
import { holdingNumber, holdingPrice, unrealizedHoldingReturn } from "./investmentHoldingMetrics";
it("uses total position basis, preserves missing values and avoids unsupported short-position/zero-basis percentages", () => {
  expect(unrealizedHoldingReturn(100, 80, 2)).toEqual({ amount: 20, percent: 25 });
  expect(unrealizedHoldingReturn(100, 200, 2)).toEqual({ amount: -100, percent: -50 });
  expect(unrealizedHoldingReturn(100, 0, 2)).toEqual({ amount: 100, percent: null });
  for (const value of [null, undefined, "", " ", NaN, Infinity]) expect(unrealizedHoldingReturn(value, 80, 2).amount).toBeNull();
  expect(unrealizedHoldingReturn(100, null, 2).amount).toBeNull(); expect(unrealizedHoldingReturn(100, 80, -2).amount).toBeNull();
  expect(holdingNumber(" ")).toBeNull(); expect(holdingNumber(0)).toBe(0);
  expect(holdingPrice(0.00001, "USD")).toBe("$0.00001");
  expect(holdingPrice(50, "USD")).toBe("$50.00");
  expect(holdingPrice(1e-15, "USD")).not.toBe("$0.00");
});
