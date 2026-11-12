import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("./financialReportStore", async (original) => ({ ...await original<typeof import("./financialReportStore")>(), saveReport: mocks.save }));
import { reportScheduleSlots, runReportSchedule } from "./financialReportSchedule";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("FINANCIAL_REPORT_STORAGE_ENABLED", "true"); });
afterEach(() => vi.unstubAllEnvs());
it("uses the New York calendar through UTC boundaries, DST and overlapping Monday/first-day slots", () => {
  expect(reportScheduleSlots(new Date("2026-11-02T02:00:00Z"))).toMatchObject({ weekly: null, monthly: "monthly:2026-11", previousMonth: "2026-10" });
  expect(reportScheduleSlots(new Date("2026-11-02T14:00:00Z"))).toMatchObject({ weekly: "weekly:2026-11-02", monthly: null });
  expect(reportScheduleSlots(new Date("2026-06-01T14:00:00Z"))).toMatchObject({ weekly: "weekly:2026-06-01", monthly: "monthly:2026-06", previousMonth: "2026-05" });
  expect(reportScheduleSlots(new Date("2027-01-01T14:00:00Z")).previousMonth).toBe("2026-12");
});
it("dispatches only opted-in slots, preserves owner scope and reports retryable failures", async () => {
  const query = { select: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ count: 3, error: null, data: [{ user_id: "a", weekly: true, monthly: false }, { user_id: "b", weekly: false, monthly: true }, { user_id: "c", weekly: true, monthly: false }] }) };
  const client = { from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient;
  mocks.save.mockResolvedValueOnce({ skipped: true }).mockResolvedValueOnce({ skipped: false }).mockRejectedValueOnce(new Error("PRIVATE ERROR"));
  const now = new Date("2026-06-01T14:00:00Z");
  expect(await runReportSchedule(client, now)).toEqual({ saved: 1, skipped: 1, failed: 1 });
  expect(mocks.save.mock.calls).toEqual([[client, "a", "weekly:2026-06-01", now, undefined], [client, "b", "monthly:2026-06", now, "2026-05"], [client, "c", "weekly:2026-06-01", now, undefined]]);
  query.limit.mockResolvedValueOnce({ count: 4, error: null, data: [] });
  await expect(runReportSchedule(client, now)).rejects.toThrow("coverage unavailable");
});
