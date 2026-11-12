import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  ensure: vi.fn(),
  load: vi.fn(),
  googleConfig: vi.fn(),
  publish: vi.fn(),
  jobs: vi.fn(),
  service: vi.fn(),
}));
vi.mock("../../../lib/supabase/server", () => ({
  getAuthenticatedSupabaseContext: mocks.auth,
  ensureOwnProfile: mocks.ensure,
}));
vi.mock("../../../lib/financialBudgetData", () => ({
  loadFinancialBudget: mocks.load,
}));
vi.mock("../../../lib/googleBriefing", async (original) => ({
  ...(await original<typeof import("../../../lib/googleBriefing")>()),
  googleBriefingConfig: mocks.googleConfig,
  publishGoogleBriefing: mocks.publish,
}));
vi.mock("../../../lib/financialJobs", () => ({
  withFinancialJob: mocks.jobs,
  financialServiceClient: mocks.service,
}));
import { GET, PUT } from "./route";
import {
  GET as review,
  POST as saveReview,
} from "../transactions/review/route";
import { POST as briefing } from "../financial-briefing/route";
import { financialBudget } from "../../../lib/budgetEngine";
const owner = "00000000-0000-4000-8000-000000000001",
  id = "00000000-0000-4000-8000-000000000002";
const req = (method = "GET", body?: unknown) =>
  new Request("https://fixture.invalid/api/budget-engine", {
    method,
    headers: body
      ? {
          origin: "https://fixture.invalid",
          "content-type": "application/json",
        }
      : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
let upsert: ReturnType<typeof vi.fn>, rpc: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  upsert = vi.fn().mockResolvedValue({ error: null });
  rpc = vi.fn().mockResolvedValue({ data: 1 });
  mocks.auth.mockResolvedValue({
    user: { id: owner },
    supabase: { from: () => ({ upsert }), rpc },
  });
  mocks.load.mockResolvedValue({
    ...financialBudget([], [], 420),
    policy: {},
    snapshot: { accounts: [], jobs: [], transactions: [] },
  });
});
it("requires authentication on policy, review and briefing endpoints", async () => {
  mocks.auth.mockResolvedValue(null);
  for (const response of [
    await GET(req()),
    await PUT(req("PUT", { kind: "monthly", monthly_limit: 0 })),
    await review(req()),
    await saveReview(req("POST", {})),
    await briefing(req("POST", { action: "preview" })),
  ])
    expect(response.status).toBe(401);
  expect(upsert).not.toHaveBeenCalled();
});
it("rejects cross-origin mutations before any database access", async () => {
  const request = new Request("https://fixture.invalid/api/budget-engine", {
    method: "PUT",
    headers: {
      origin: "https://attacker.invalid",
      "content-type": "application/json",
    },
    body: "{}",
  });
  expect((await PUT(request)).status).toBe(403);
  expect(mocks.auth).not.toHaveBeenCalled();
});
it("persists explicit zero/unset monthly limits without changing weekly settings", async () => {
  for (const monthly_limit of [null, 0, 500])
    expect(
      (await PUT(req("PUT", { kind: "monthly", monthly_limit }))).status,
    ).toBe(200);
  expect(upsert.mock.calls.map(([value]) => value)).toEqual(
    [null, 0, 500].map((monthly_limit) => ({ user_id: owner, monthly_limit })),
  );
});
it.each([-1, 0.001, "420", 100000001])(
  "rejects invalid monthly limit %j",
  async (monthly_limit) => {
    expect(
      (await PUT(req("PUT", { kind: "monthly", monthly_limit }))).status,
    ).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  },
);
it("cannot inject another owner or privileged fields into category rules", async () => {
  expect(
    (
      await PUT(
        req("PUT", { kind: "category", category: "groceries", user_id: id }),
      )
    ).status,
  ).toBe(400);
  expect(upsert).not.toHaveBeenCalled();
});
it("returns sanitized errors for unavailable schema/provider details", async () => {
  mocks.load.mockRejectedValue(
    new Error("private service key and raw metadata"),
  );
  const response = await GET(req());
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private");
});
it("dry-run review never persists anything", async () => {
  const response = await review(req());
  expect(await response.json()).toMatchObject({
    dryRun: true,
    persisted: false,
  });
  expect(upsert).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled();
});
it("requires explicit confirmation and a distinct bounded review selection", async () => {
  for (const body of [
    { ids: [id], category: "groceries", weekly: "include", monthly: "default" },
    {
      ids: [id, id],
      category: "groceries",
      weekly: "include",
      monthly: "default",
      confirmed: true,
    },
  ])
    expect((await saveReview(req("POST", body))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it("saves only explicit review preferences through the owner-safe atomic RPC", async () => {
  expect(
    (
      await saveReview(
        req("POST", {
          ids: [id],
          category: "groceries",
          weekly: "include",
          monthly: "default",
          confirmed: true,
        }),
      )
    ).status,
  ).toBe(200);
  expect(rpc).toHaveBeenCalledWith("review_budget_transactions", {
    ids: [id],
    category: "groceries",
    weekly: "include",
    monthly: "default",
  });
});
it("rejects unconfirmed/expired publishing without invoking Google or privileged jobs", async () => {
  expect(
    (
      await briefing(
        req("POST", {
          action: "publish",
          generatedAt: "2000-01-01",
          hash: "fake",
          confirmed: true,
        }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.publish).not.toHaveBeenCalled();
  expect(mocks.service).not.toHaveBeenCalled();
});
it("preview never contacts Google, while confirmed matching publish uses the durable job", async () => {
  const response = await briefing(req("POST", { action: "preview" }));
  expect(response.status).toBe(200);
  const { preview } = await response.json();
  expect(preview.text).toContain("$420.00");
  expect(mocks.googleConfig).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
  mocks.jobs.mockImplementation(async (_client, _user, _kind, _key, work) =>
    work(),
  );
  mocks.publish.mockResolvedValue({ published: true });
  expect(
    (
      await briefing(
        req("POST", {
          action: "publish",
          generatedAt: preview.generatedAt,
          hash: preview.hash,
          confirmed: true,
        }),
      )
    ).status,
  ).toBe(200);
  expect(mocks.publish).toHaveBeenCalledWith(owner, preview.text);
  expect(mocks.jobs).toHaveBeenCalledOnce();
});
it("rejects changed preview hashes before any privileged work", async () => {
  expect(
    (
      await briefing(
        req("POST", {
          action: "publish",
          generatedAt: new Date().toISOString(),
          hash: "incorrect",
          confirmed: true,
        }),
      )
    ).status,
  ).toBe(400);
  expect(mocks.service).not.toHaveBeenCalled();
  expect(mocks.publish).not.toHaveBeenCalled();
});
