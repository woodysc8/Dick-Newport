import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), generate: vi.fn(), read: vi.fn(), latest: vi.fn(), save: vi.fn(), history: vi.fn() }));
vi.mock("../../../lib/supabase/server", () => ({ getAuthenticatedSupabaseContext: mocks.auth }));
vi.mock("../../../lib/financialReport", () => ({ generateFinancialReport: mocks.generate }));
vi.mock("../../../lib/financialReportStore", async (original) => ({ ...await original<typeof import("../../../lib/financialReportStore")>(), readReport: mocks.read, latestReport: mocks.latest, saveReport: mocks.save, reportHistory: mocks.history }));
import { GET, POST } from "./route";
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("FINANCIAL_REPORT_STORAGE_ENABLED", "false"); mocks.auth.mockResolvedValue({ user: { id: "authenticated-owner" }, supabase: {} }); mocks.generate.mockResolvedValue({ generatedAt: "now", sections: [] }); });
afterEach(() => vi.unstubAllEnvs());
const request = (method = "GET", body?: unknown) => new Request("https://fixture.invalid/api/financial-report", { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
it("requires authentication and prevents cross-origin writes", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  expect((await GET(request())).status).toBe(401);
  expect((await POST(new Request("https://fixture.invalid/api/financial-report", { method: "POST", headers: { Origin: "https://attacker.invalid" } }))).status).toBe(403);
  expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it("offers an unsaved authenticated preview without storage queries or financial writes", async () => {
  const response = await GET(request());
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ id: null, storageEnabled: false });
  expect(mocks.generate).toHaveBeenCalledWith({}, "authenticated-owner", null);
  expect(mocks.latest).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  expect((await POST(request("POST", { action: "update" }))).status).toBe(503);
});
it("returns frozen historical content without recalculating and keeps owner scope", async () => {
  vi.stubEnv("FINANCIAL_REPORT_STORAGE_ENABLED", "true");
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.auth.mockResolvedValue({ user: { id: "authenticated-owner" }, supabase: { from: () => query } });
  const frozen = { generatedAt: "old", sections: [{ title: "Frozen", lines: ["$100.00"] }] };
  mocks.read.mockResolvedValue({ id: "snapshot", report: frozen }); mocks.history.mockResolvedValue([]);
  const response = await GET(new Request("https://fixture.invalid/api/financial-report?id=snapshot"));
  expect((await response.json()).report).toEqual(frozen);
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.read.mock.calls[0].slice(1)).toEqual(["authenticated-owner", "snapshot"]);
});
it("ignores supplied owner/report contents when creating a new snapshot", async () => {
  vi.stubEnv("FINANCIAL_REPORT_STORAGE_ENABLED", "true"); mocks.save.mockResolvedValue({ id: "new", report: {} }); mocks.history.mockResolvedValue([]);
  expect((await POST(request("POST", { action: "update", user_id: "victim", report: { netWorth: 999999 } }))).status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith({}, "authenticated-owner");
});
it("sanitizes unexpected errors", async () => {
  mocks.generate.mockRejectedValue(new Error("SECRET account details"));
  const response = await GET(request()); expect(response.status).toBe(503); expect(await response.text()).not.toContain("SECRET");
});
