// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), position: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a> }));
vi.mock("../../lib/supabase/server", () => ({ getAuthenticatedSupabaseContext: mocks.auth }));
vi.mock("../../lib/connectedPosition", async (original) => ({ ...(await original<typeof import("../../lib/connectedPosition")>()), loadConnectedPosition: mocks.position }));
vi.mock("../components/FinancePage", () => ({ Shell: ({ children }: React.PropsWithChildren) => <main>{children}</main>, PagePanel: ({ children }: React.PropsWithChildren) => <section>{children}</section> }));
import InvestmentsPage from "./page";
import { summarizeConnectedPosition, type ConnectedAccount } from "../../lib/connectedPosition";
const account: ConnectedAccount = { id: "account", institution_name: "Fixture", account_name: "Brokerage", account_type: "investment", account_subtype: "brokerage", current_balance: 500, available_balance: null, currency: "USD", mask: null, plaid_account_id: "private-account-id", persistent_account_id: null, created_at: "2020-01-01", updated_at: "2026-11-12" };
function client(holdings: unknown[], error: unknown = null) {
  const q = { select: vi.fn(() => q), eq: vi.fn(() => q), order: vi.fn(() => q), limit: vi.fn(async () => ({ data: holdings, count: holdings.length, error })) };
  const supabase = { from: vi.fn(() => q) };
  mocks.auth.mockResolvedValue({ user: { id: "owner" }, supabase });
  mocks.position.mockResolvedValue(summarizeConnectedPosition([account]));
  return { q, supabase };
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("requires authentication before any holdings query", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  await expect(InvestmentsPage()).rejects.toThrow("redirect:/login");
  expect(mocks.position).not.toHaveBeenCalled();
});
it("renders saved security fields with owner scoping, keeping balances separate from positions", async () => {
  const { q } = client([{ id: "holding", plaid_account_id: account.plaid_account_id, security_name: "Fixture fund", ticker_symbol: "VTI", quantity: 2, institution_value: 100, institution_price: 50, cost_basis: 80, currency: "USD" }]);
  render(await InvestmentsPage());
  expect(screen.getByRole("heading", { name: "Connected investment account balances" }).nextElementSibling?.textContent).toBe("$500.00");
  expect(screen.queryByText("$600.00")).toBeNull();
  expect(within(screen.getByRole("table")).getAllByRole("columnheader").map((e) => e.textContent)).toEqual(["Security", "Ticker", "Quantity", "Current value", "Price", "Cost basis"]);
  for (const value of ["VTI", "$100.00", "$50.00", "$80.00"]) expect(screen.getByText(value)).toBeTruthy();
  expect(screen.getByText("Purchase history unavailable")).toBeTruthy();
  expect(screen.queryByText("2020-01-01")).toBeNull();
  expect(q.eq).toHaveBeenCalledWith("user_id", "owner");
  expect(q.limit).toHaveBeenCalledWith(501);
});
it("distinguishes empty holdings from missing account balances and reports query failures", async () => {
  client([]);
  const { unmount } = render(await InvestmentsPage());
  expect(screen.getByText("Investment balances connected. Individual holdings are not yet available.")).toBeTruthy();
  expect(screen.getByText("Purchase history unavailable")).toBeTruthy();
  unmount();
  client([], { message: "private DB details" });
  render(await InvestmentsPage());
  expect(screen.getByRole("alert").textContent).toContain("Holdings could not be loaded");
  expect(screen.queryByText("private DB details")).toBeNull();
});
it("keeps missing quantities, prices, currency and cost basis unavailable instead of zero", async () => {
  client([{ id: "unknown", security_name: "Unknown fund", plaid_account_id: null, quantity: null, institution_value: null, institution_price: null, cost_basis: null, currency: null }]);
  render(await InvestmentsPage());
  expect(within(screen.getByRole("table")).getAllByText("Unavailable")).toHaveLength(5);
});
