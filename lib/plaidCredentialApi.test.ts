import { afterEach, describe, expect, it, vi } from "vitest";
import { CredentialResponseError, readCredentialResponse, requestCredentialStatus } from "./plaidCredentialApi";

afterEach(() => vi.unstubAllGlobals());
describe("credential response contract", () => {
  it.each([200, 204, 405, 502])("handles empty HTTP %i without a JSON parsing exception", async status => {
    await expect(readCredentialResponse(new Response(null, { status }))).rejects.toThrow(`empty response (HTTP ${status})`);
  });
  it("handles whitespace, malformed JSON, HTML and invalid status shapes", async () => {
    await expect(readCredentialResponse(new Response(" \n", { status: 200 }))).rejects.toThrow("empty response");
    await expect(readCredentialResponse(new Response("{", { headers: { "Content-Type": "application/json" } }))).rejects.toThrow("invalid JSON");
    await expect(readCredentialResponse(new Response("<html>private upstream body</html>", { status: 502, headers: { "Content-Type": "text/html" } }))).rejects.toThrow("non-JSON response (HTTP 502)");
    for (const data of [null, [], {}, { configured: "false" }, { configured: true }, { configured: true, environment: "production", status: "active", verifiedAt: "invalid" }]) {
      await expect(readCredentialResponse(Response.json(data))).rejects.toThrow("invalid credential status");
    }
  });
  it("accepts and projects only safe status fields", async () => {
    expect(await readCredentialResponse(Response.json({ configured: false, secret: "synthetic-secret" }))).toEqual({ configured: false });
    expect(await readCredentialResponse(Response.json({ configured: true, environment: "production", status: "active", verifiedAt: null, encrypted_credentials: "synthetic-ciphertext" })))
      .toEqual({ configured: true, environment: "production", status: "active", verifiedAt: null });
    const response = new Response('{"configured":false}', { headers: { "Content-Type": "application/problem+json; charset=utf-8" } });
    expect(await readCredentialResponse(response)).toEqual({ configured: false });
  });
  it.each([400, 401, 403, 405, 409, 422, 500, 503])("does not reflect error bodies for HTTP %i", async status => {
    const result = readCredentialResponse(Response.json({ error: "synthetic-private-response" }, { status }));
    await expect(result).rejects.toBeInstanceOf(CredentialResponseError);
    await expect(result).rejects.not.toThrow("synthetic-private-response");
  });
  it("handles redirects and interrupted response streams", async () => {
    const redirected = Response.json({ configured: false });
    Object.defineProperty(redirected, "redirected", { value: true });
    await expect(readCredentialResponse(redirected)).rejects.toThrow("session may have expired");
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error("synthetic-private-stream")); } }));
    await expect(readCredentialResponse(response)).rejects.toThrow("response was interrupted");
  });
  it("normalizes fetch failures without exposing exception text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("synthetic-private-network")));
    await expect(requestCredentialStatus()).rejects.toThrow("Unable to reach the credential server");
  });
});
