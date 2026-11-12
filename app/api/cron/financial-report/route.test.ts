import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), run: vi.fn() }));
vi.mock("../../../../lib/financialJobs", async (original) => ({ ...await original<typeof import("../../../../lib/financialJobs")>(), financialServiceClient: mocks.service }));
vi.mock("../../../../lib/financialReportSchedule", () => ({ runReportSchedule: mocks.run }));
import { GET } from "./route";
const secret = "fixture-secret-with-at-least-32-characters";
const req = (authorized = true) => new Request("https://fixture.invalid/api/cron/financial-report", { headers: authorized ? { authorization: `Bearer ${secret}` } : {} });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", secret); vi.stubEnv("FINANCIAL_REPORT_STORAGE_ENABLED", "false"); vi.stubEnv("FINANCIAL_REPORT_SCHEDULE_ENABLED", "false"); });
afterEach(() => vi.unstubAllEnvs());
it("requires the scheduler secret before any service-role work", async () => {
  expect((await GET(req(false))).status).toBe(401); expect(mocks.service).not.toHaveBeenCalled();
  vi.stubEnv("CRON_SECRET", "short"); expect((await GET(req())).status).toBe(401);
});
it("does no work by default or when either activation gate is off", async () => {
  expect(await (await GET(req())).json()).toEqual({ enabled: false });
  vi.stubEnv("FINANCIAL_REPORT_SCHEDULE_ENABLED", "true");
  expect(await (await GET(req())).json()).toEqual({ enabled: false }); expect(mocks.run).not.toHaveBeenCalled();
});
it("returns aggregate retryable status and never exposes financial errors", async () => {
  vi.stubEnv("FINANCIAL_REPORT_STORAGE_ENABLED", "true"); vi.stubEnv("FINANCIAL_REPORT_SCHEDULE_ENABLED", "true");
  mocks.service.mockReturnValue("service"); mocks.run.mockResolvedValueOnce({ saved: 1, skipped: 2, failed: 1 });
  expect((await GET(req())).status).toBe(503); expect(mocks.run).toHaveBeenCalledWith("service");
  mocks.run.mockRejectedValueOnce(new Error("SECRET FINANCIAL DATA"));
  const response = await GET(req()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("SECRET");
});
