import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { holdingStatusMessage, loadInvestmentHoldingState } from "./investmentHoldingState";
it("keeps missing schema distinct from legitimate read errors, and scopes fallback reads to the owner", async () => {
  const q = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValueOnce({ data: null, error: { code: "42703" } }).mockResolvedValueOnce({ data: [{ account_type: "investment", account_name: "Roth IRA" }], count: 1, error: null }) };
  const client = { from: vi.fn().mockReturnValue(q) } as unknown as SupabaseClient;
  expect(await loadInvestmentHoldingState(client, "owner")).toMatchObject({ schemaReady: false, accounts: [{ account_name: "Roth IRA" }] });
  expect(q.eq.mock.calls).toEqual([["user_id", "owner"], ["user_id", "owner"]]);
  q.limit.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  await expect(loadInvestmentHoldingState(client, "owner")).rejects.toThrow("coverage unavailable");
  expect(q.select).toHaveBeenCalledTimes(3);
});
it("distinguishes empty imports, missing permission, not-yet-synced and retained stale positions", () => {
  expect(holdingStatusMessage("empty", "2026-11-12")).toContain("Plaid returned no holdings");
  expect(holdingStatusMessage("permission_required", null)).toContain("permission required");
  expect(holdingStatusMessage(undefined, null)).toContain("not yet synced");
  expect(holdingStatusMessage("error", "2026-11-10")).toContain("old positions retained");
  expect(holdingStatusMessage("not_returned", "2026-11-10")).toContain("Account missing");
});
