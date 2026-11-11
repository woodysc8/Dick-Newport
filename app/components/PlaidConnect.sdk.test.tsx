// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import PlaidConnect from "./PlaidConnect";

it("loads one SDK script and keeps at most one active Link handler through Strict Mode", async () => {
  let active = 0, maximum = 0;
  const create = vi.fn(() => {
    active += 1; maximum = Math.max(maximum, active);
    return { open: vi.fn(), exit: vi.fn(), destroy: () => { active -= 1; } };
  });
  Object.defineProperty(window, "Plaid", { configurable: true, value: { create } });
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ link_token: "link", expiration: "2030-01-01", credential_session: "session" }));
  try {
    render(<StrictMode><PlaidConnect /></StrictMode>);
    const selector = 'script[src="https://cdn.plaid.com/link/v2/stable/link-initialize.js"]';
    expect(document.querySelectorAll(selector)).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Connect a bank" }));
    await waitFor(() => expect(document.querySelectorAll(selector)).toHaveLength(1));
    expect(create).not.toHaveBeenCalled();
    fireEvent.load(document.querySelector(selector)!);
    await waitFor(() => expect((screen.getByRole("button", { name: "Open Plaid" }) as HTMLButtonElement).disabled).toBe(false));
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    expect(maximum).toBe(1);
    expect(active).toBe(1);
    cleanup();
    expect(active).toBe(0);
  } finally { cleanup(); fetch.mockRestore(); }
});
