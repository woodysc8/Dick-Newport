// @vitest-environment jsdom
import React, { StrictMode, useEffect } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), hook: vi.fn(), open: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("react-plaid-link", () => ({ usePlaidLink: mocks.hook }));
vi.mock("next/script", () => ({ default: function Script({ onReady }: { onReady: () => void }) {
  useEffect(() => { onReady(); }, [onReady]);
  return null;
} }));
import PlaidConnect from "./PlaidConnect";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hook.mockReturnValue({ ready: true, open: mocks.open });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps exchange success separate from failed sync and retries saved Items without Link", async () => {
  const fetch = vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ link_token: "link", expiration: "2030-01-01", credential_session: "session" }))
    .mockResolvedValueOnce(Response.json({ connected: true }))
    .mockResolvedValueOnce(Response.json({ error: "Retry shortly" }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ success: true, status: "completed", items: [] }));
  render(<StrictMode><PlaidConnect /></StrictMode>);
  expect(mocks.hook).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Connect a bank" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Open Plaid" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Open Plaid" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Plaid" }));
  expect(mocks.open).toHaveBeenCalledOnce();
  const callback = mocks.hook.mock.calls.at(-1)![0].onSuccess;
  await act(async () => { await Promise.all([callback("public"), callback("public")]); });
  expect(screen.getByRole("status").textContent).toContain("Connection saved. Financial data could not be refreshed.");
  expect(screen.getByRole("alert").textContent).toBe("Retry shortly");
  expect(fetch.mock.calls.filter(([url]) => url === "/api/plaid/exchange-token")).toHaveLength(1);
  const hookCalls = mocks.hook.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Refresh saved connections" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Financial data refreshed"));
  expect(mocks.hook).toHaveBeenCalledTimes(hookCalls);
  expect(fetch.mock.calls.filter(([url]) => url === "/api/plaid/refresh").map(([, options]) => options)).toEqual([{ method: "POST" }, { method: "POST" }]);
});

it("refreshes existing Items on a fresh page without initializing Link or concurrent requests", async () => {
  let resolve!: (response: Response) => void;
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<PlaidConnect />);
  const retry = screen.getByRole("button", { name: "Refresh saved connections" });
  fireEvent.click(retry); fireEvent.click(retry);
  expect(fetch).toHaveBeenCalledOnce();
  expect(mocks.hook).not.toHaveBeenCalled();
  await act(async () => resolve(Response.json({ success: true, status: "completed", items: [] })));
  expect(screen.getByRole("status").textContent).toContain("Financial data refreshed");
});
