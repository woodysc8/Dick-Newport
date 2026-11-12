// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ link: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("next/script", () => ({ default: ({ onReady }: { onReady: () => void }) => <button onClick={onReady}>Load SDK</button> }));
vi.mock("react-plaid-link", () => ({ usePlaidLink: mocks.link }));
import InvestmentHoldingsControls from "./InvestmentHoldingsControls";
const status = { setupRequired: false, connections: [{ id: "internal-connection", institution: "Robinhood", active: true, permissionRecorded: true, accounts: [{ id: "individual", name: "Robinhood Individual", subtype: "brokerage", status: "not_synced", syncedAt: null }, { id: "roth", name: "Robinhood Roth IRA", subtype: "roth", status: "not_synced", syncedAt: null }, { id: "crypto", name: "Crypto", subtype: "crypto exchange", status: "empty", syncedAt: "2026-11-12T15:00:00Z" }] }] };
const session = (mode: string) => ({ mode, link_token: "synthetic-link", credential_session: "encrypted-session", expiration: "2030-01-01" });
const ok = (data: unknown) => ({ ok: true, json: async () => data });
beforeEach(() => { vi.clearAllMocks(); mocks.link.mockReturnValue({ ready: true, open: vi.fn() }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); });
it("verifies update consent with no public-token exchange or automatic holdings/transaction sync", async () => {
  const fetcher = vi.fn(async (url: string, options?: { body?: string }) => {
    if (!options?.body) return ok(status);
    if (url.endsWith("create-investment-update-link-token")) return ok(session("update"));
    if (JSON.parse(options.body).action === "verify") return ok({ authorized: true, message: "Permission verified. Choose Sync holdings." });
    throw new Error("Unexpected write or sync");
  });
  vi.stubGlobal("fetch", fetcher); render(<InvestmentHoldingsControls />);
  await screen.findByText(/Robinhood Individual/); expect(screen.getByText(/Crypto ·/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Enable holdings" }));
  fireEvent.click(await screen.findByRole("button", { name: "Load SDK" }));
  await waitFor(() => expect(mocks.link).toHaveBeenCalled());
  await act(async () => mocks.link.mock.calls.at(-1)![0].onSuccess(""));
  await screen.findByText("Permission verified. Choose Sync holdings.");
  const bodies = fetcher.mock.calls.filter((c) => c[1]?.body).map((c) => JSON.parse(c[1]!.body!));
  expect(bodies).toEqual([{ connection_id: "internal-connection", mode: "update" }, { action: "verify", credential_session: "encrypted-session" }]);
});
it("imports only after the explicit Sync holdings action and renders a retryable provider state", async () => {
  const fetcher = vi.fn(async (_url: string, options?: { body?: string }) => options?.body ? ok({ success: false, status: "not_ready", message: "Plaid is preparing holdings. Retry Sync holdings later." }) : ok(status));
  vi.stubGlobal("fetch", fetcher); render(<InvestmentHoldingsControls />);
  fireEvent.click(await screen.findByRole("button", { name: "Sync holdings" }));
  await screen.findByRole("alert");
  expect(fetcher.mock.calls.find((c) => c[1]?.body)?.[1]?.body).toBe(JSON.stringify({ action: "sync", connection_id: "internal-connection", approved: true }));
  expect(screen.getByRole("alert").textContent).toContain("Retry Sync holdings"); expect(mocks.link).not.toHaveBeenCalled();
});
it("offers separate consent explicitly and exchanges only the new Item without refreshing saved connections", async () => {
  const fetcher = vi.fn(async (url: string, options?: { body?: string }) => !options?.body ? ok(status) : url.endsWith("exchange-token") ? ok({ connected: true }) : ok(session("separate")));
  vi.stubGlobal("fetch", fetcher); render(<InvestmentHoldingsControls />);
  fireEvent.click(await screen.findByRole("button", { name: "Add separate investment connection" }));
  fireEvent.click(await screen.findByRole("button", { name: "Load SDK" }));
  await waitFor(() => expect(mocks.link).toHaveBeenCalled());
  await act(async () => mocks.link.mock.calls.at(-1)![0].onSuccess("synthetic-new-public"));
  await screen.findByText(/Separate connection saved/);
  expect(fetcher.mock.calls.some((c) => c[0].endsWith("exchange-token"))).toBe(true);
  expect(fetcher.mock.calls.some((c) => c[0].endsWith("refresh"))).toBe(false);
  expect(fetcher.mock.calls.some((c) => c[1]?.body && JSON.parse(c[1].body).action === "sync")).toBe(false);
});
