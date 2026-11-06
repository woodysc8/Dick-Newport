import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  exchangePlaidPublicToken,
  isPlaidLinkTokenExpired,
  openPlaidLink,
  requestPlaidLinkToken,
  requestPlaidRefresh,
  safePlaidCode,
} from "./PlaidConnect";

describe("Plaid dashboard request flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requests a Link token without sending user or Item identifiers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ link_token: "link-token", expiration: "2030-01-01T00:00:00Z" }), { status: 200 }),
    );

    await expect(requestPlaidLinkToken()).resolves.toEqual({ token: "link-token", expiration: "2030-01-01T00:00:00Z" });
    expect(fetchMock).toHaveBeenCalledWith("/api/plaid/create-link-token", { method: "POST" });
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("user_id");
  });

  it("rejects a Link token response without an expiration", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ link_token: "link-token" }), { status: 200 }),
    );

    await expect(requestPlaidLinkToken()).rejects.toThrow("Unable to prepare Plaid connection");
  });

  it("detects expired or invalid Link token expirations", () => {
    expect(isPlaidLinkTokenExpired("2025-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:00Z"))).toBe(true);
    expect(isPlaidLinkTokenExpired("not-a-date", Date.parse("2026-01-01T00:00:00Z"))).toBe(true);
    expect(isPlaidLinkTokenExpired("2027-01-01T00:00:00Z", Date.parse("2026-01-01T00:00:00Z"))).toBe(false);
  });

  it("allows only safe Plaid error code characters and length", () => {
    expect(safePlaidCode("INVALID_LINK_TOKEN")).toBe("INVALID_LINK_TOKEN");
    expect(safePlaidCode("phone: 5551234")).toBeNull();
    expect(safePlaidCode("A".repeat(65))).toBeNull();
  });

  it("exchanges only the Plaid public token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ connected: true }), { status: 200 }),
    );

    await exchangePlaidPublicToken("public-token");
    expect(fetchMock).toHaveBeenCalledWith("/api/plaid/exchange-token", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ public_token: "public-token" }),
    }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("access_token");
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("user_id");
  });

  it("opens Plaid only after Link is ready", () => {
    const open = vi.fn();

    openPlaidLink(open, false);
    expect(open).not.toHaveBeenCalled();

    openPlaidLink(open, true);
    expect(open).toHaveBeenCalledOnce();
  });

  it("requests refresh through the authenticated route and preserves partial status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        success: false,
        status: "completed",
        items: [{
          institution: "Sandbox Bank",
          plaid_item_id: "item-a",
          status: "error",
          accounts_updated: 0,
          accounts_created: 0,
          transactions_added: 0,
          transactions_modified: 0,
          transactions_removed: 0,
          holdings_updated: 0,
          holdings_removed: 0,
          error_count: 1,
          warning_count: 0,
        }],
      }), { status: 200 }),
    );

    await expect(requestPlaidRefresh()).resolves.toMatchObject({ success: false, status: "completed" });
  });

  it("surfaces safe API errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Unable to save Plaid connection" }), { status: 500 }),
    );

    await expect(exchangePlaidPublicToken("public-token")).rejects.toThrow("Unable to save Plaid connection");
  });

  it("does not call disabled investment or repair routes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ link_token: "link-token", expiration: "2030-01-01T00:00:00Z" }), { status: 200 }),
    );

    await requestPlaidLinkToken();
    expect(fetchMock.mock.calls.flat().join(" ")).not.toContain("investment-update");
    expect(fetchMock.mock.calls.flat().join(" ")).not.toContain("bilt-repair");
  });
});
