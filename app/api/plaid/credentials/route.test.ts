import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), status: vi.fn(), save: vi.fn(), verify: vi.fn(), remove: vi.fn(), lock: vi.fn() }));
vi.mock("../../../../lib/plaidTenant", () => ({ getAuthenticatedPlaidContext: mocks.auth }));
vi.mock("../../../../lib/plaidCredentials", () => ({
  credentialStatus: mocks.status, saveCredentials: mocks.save, verifyCredentials: mocks.verify, deleteCredentials: mocks.remove,
  validateCredentials: (body: unknown) => body,
}));
vi.mock("../../../../lib/plaidOperations", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../lib/plaidOperations")>(), withPlaidOperation: mocks.lock,
}));
import { GET, POST, PUT, DELETE, OPTIONS, PATCH } from "./route";
import { PlaidOperationError } from "../../../../lib/plaidOperations";

function request(method = "GET", body?: string, origin?: string) {
  return new Request("http://localhost/api/plaid/credentials", { method,
    headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, ...(body ? { body } : {}) });
}
async function expectJson(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}
beforeEach(() => {
  vi.resetAllMocks(); delete process.env.NEXT_PUBLIC_SITE_URL;
  mocks.auth.mockResolvedValue({ userId: "synthetic-user" });
  mocks.status.mockResolvedValue({ configured: false });
  mocks.lock.mockImplementation((_context: unknown, work: () => Promise<unknown>) => work());
});
describe("credential API JSON responses", () => {
  it("returns JSON for status, Save, Verify, Replace, Delete and unsupported methods", async () => {
    for (const [handler, method, body] of [[GET, "GET"], [POST, "POST", "{}"], [POST, "POST", '{"action":"verify"}'], [PUT, "PUT", "{}"], [DELETE, "DELETE"]] as const) {
      expect(await expectJson(await handler(request(method, body)), 200)).toEqual({ configured: false });
    }
    expect(mocks.save).toHaveBeenCalledTimes(2); expect(mocks.verify).toHaveBeenCalledOnce(); expect(mocks.remove).toHaveBeenCalledOnce();
    await expectJson(await OPTIONS(), 200);
    await expectJson(await PATCH(), 405);
  });
  it("authenticates every management method before touching storage or Plaid", async () => {
    mocks.auth.mockResolvedValue(null);
    for (const [handler, method] of [[GET, "GET"], [POST, "POST"], [PUT, "PUT"], [DELETE, "DELETE"]] as const) {
      expect(await expectJson(await handler(request(method)), 401)).toEqual({ error: "Authentication required" });
    }
    expect(mocks.lock).not.toHaveBeenCalled(); expect(mocks.status).not.toHaveBeenCalled();
  });
  it("normalizes unexpected authentication, storage and mutation failures", async () => {
    mocks.auth.mockRejectedValueOnce(new Error("synthetic-private-auth"));
    expect(JSON.stringify(await expectJson(await GET(request()), 500))).not.toContain("synthetic-private-auth");
    mocks.status.mockRejectedValueOnce(new Error("synthetic-private-storage"));
    expect(JSON.stringify(await expectJson(await GET(request()), 500))).not.toContain("synthetic-private-storage");
    mocks.save.mockRejectedValueOnce(new Error("synthetic-private-mutation"));
    expect(JSON.stringify(await expectJson(await POST(request("POST", "{}")), 500))).not.toContain("synthetic-private-mutation");
  });
  it("returns JSON for invalid bodies, contention, origin errors and invalid server origin configuration", async () => {
    await expectJson(await POST(request("POST", "{")), 400);
    await expectJson(await POST(request("POST", JSON.stringify({ value: "x".repeat(5000) }))), 400);
    await expectJson(await DELETE(request("DELETE", "{}")), 400);
    mocks.lock.mockRejectedValueOnce(new PlaidOperationError("Another Plaid operation is running. Please retry shortly.", 409));
    await expectJson(await POST(request("POST", "{}")), 409);
    await expectJson(await POST(request("POST", "{}", "https://attacker.example")), 403);
    process.env.NEXT_PUBLIC_SITE_URL = "invalid-url";
    await expectJson(await POST(request("POST", "{}", "http://localhost")), 500);
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
  it("keeps safe Plaid verification failures as JSON", async () => {
    mocks.verify.mockRejectedValueOnce(new PlaidOperationError("Plaid rejected these credentials. Check the Client ID, secret, and environment.", 422));
    await expectJson(await POST(request("POST", '{"action":"verify"}')), 422);
  });
});
