import { afterEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { latestReport, readReport, saveReport } from "./financialReportStore";
afterEach(() => vi.unstubAllEnvs());
it("blocks all saving before activation and does not read or write", async () => {
  vi.stubEnv("FINANCIAL_REPORT_STORAGE_ENABLED", "false");
  const client = { from: vi.fn() };
  await expect(saveReport(client as unknown as SupabaseClient, "owner")).rejects.toThrow("disabled");
  expect(client.from).not.toHaveBeenCalled();
});
it("scopes historical lookup to the authenticated owner and rejects foreign/missing reports", async () => {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  const client = { from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient;
  await expect(readReport(client, "owner", "00000000-0000-4000-8000-000000000001")).rejects.toMatchObject({ status: 404 });
  expect(query.eq).toHaveBeenCalledWith("user_id", "owner");
  expect(await latestReport(client, "owner")).toBeNull();
  query.limit.mockResolvedValueOnce({ data: [], error: { message: "secret database metadata" } });
  await expect(latestReport(client, "owner")).rejects.toThrow("history unavailable");
});
it("skips an already completed scheduled key without generating or modifying anything", async () => {
  vi.stubEnv("FINANCIAL_REPORT_STORAGE_ENABLED", "true");
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: "existing" }, error: null }) };
  const client = { from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient;
  expect(await saveReport(client, "owner", "weekly:2026-11-09")).toEqual({ id: "existing", skipped: true });
  expect(query.eq.mock.calls).toEqual([["user_id", "owner"], ["schedule_key", "weekly:2026-11-09"]]);
  expect(client.from).toHaveBeenCalledTimes(1);
});
