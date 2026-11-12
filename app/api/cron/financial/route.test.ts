import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), run: vi.fn() }));
vi.mock("../../../../lib/plaidTenant", () => ({
  getScheduledPlaidContext: mocks.context,
}));
vi.mock("../../../../lib/scheduledFinancialSync", () => ({
  runScheduledFinance: mocks.run,
}));
import { GET } from "./route";
const secret = "fixture-secret-with-at-least-32-characters";
const req = (auth = true) =>
  new Request("https://fixture.invalid/api/cron/financial", {
    headers: auth ? { authorization: `Bearer ${secret}` } : {},
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", secret);
  vi.stubEnv("SCHEDULED_FINANCE_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());
it("rejects unauthenticated scheduler calls without work", async () => {
  expect((await GET(req(false))).status).toBe(401);
  expect(mocks.context).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});
it("is safely disabled by default even with the correct secret", async () => {
  expect(await (await GET(req())).json()).toMatchObject({
    enabled: false,
    skipped: true,
  });
  expect(mocks.context).not.toHaveBeenCalled();
});
it("requires delegated owner validation after secret validation", async () => {
  vi.stubEnv("SCHEDULED_FINANCE_ENABLED", "true");
  mocks.context.mockResolvedValue(null);
  expect((await GET(req())).status).toBe(503);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("returns sanitized status and never leaks provider exceptions", async () => {
  vi.stubEnv("SCHEDULED_FINANCE_ENABLED", "true");
  mocks.context.mockResolvedValue({ owner: "fixture" });
  mocks.run.mockRejectedValue(new Error("sensitive provider metadata"));
  const response = await GET(req());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("sensitive");
});
