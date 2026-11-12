// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), position: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a> }));
vi.mock("../lib/supabase/server", () => ({ getAuthenticatedSupabaseContext: mocks.auth }));
vi.mock("../lib/connectedPosition", () => ({ loadConnectedPosition: mocks.position }));
vi.mock("./components/FinancePage", () => ({ Shell: ({ children }: React.PropsWithChildren) => <main>{children}</main>, PagePanel: ({ children }: React.PropsWithChildren) => <section>{children}</section> }));
vi.mock("./components/MonthlyTransactions", () => ({ default: ({ initialQuery }: { initialQuery: string }) => <div>Monthly history: {initialQuery}</div> }));
import TransactionsPage from "./transactions/page";
import Home from "./page";
import BudgetPage from "./budget/page";
import FinanceNav from "./components/FinanceNav";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("restores an authenticated Overview while keeping the budget route retired", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  await expect(Home()).rejects.toThrow("redirect:/login");
  mocks.auth.mockResolvedValueOnce({ user: { id: "owner" }, supabase: {} });
  mocks.position.mockResolvedValueOnce({ summary: { configured: true, netWorth: 1200, cash: 1000, investments: 500, credit: 300, currency: "USD" }, accounts: [], duplicatesOmitted: 0 });
  render(await Home());
  expect(screen.getByRole("heading", { name: "Net worth" })).toBeTruthy();
  expect(screen.getByText("$1,200.00")).toBeTruthy();
  expect(screen.getByRole("link", { name: "View investments" }).getAttribute("href")).toBe("/investments");
  expect(screen.getByRole("link", { name: "View transactions" }).getAttribute("href")).toBe("/transactions");
  expect(mocks.position).toHaveBeenCalledWith({}, "owner");
  expect(screen.getByText(/Monthly history/)).toBeTruthy();
  expect(screen.queryByText(/weekly|allowance|target|classification/i)).toBeNull();
  expect(() => BudgetPage()).toThrow("redirect:/transactions");
});
it("shows Overview first and keeps Transactions and Investments without budget navigation", () => {
  render(<FinanceNav active="Overview" />);
  expect(screen.getAllByRole("link")[0].getAttribute("href")).toBe("/");
  expect(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Transactions" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /budget/i })).toBeNull();
});
it("authenticates monthly history and mounts only the monthly interface", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  await expect(TransactionsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
  mocks.auth.mockResolvedValueOnce({ user: { id: "owner" } });
  render(await TransactionsPage({ searchParams: Promise.resolve({ month: "2026-11", account: "fixture", page: "2", category: "needs_review" }) }));
  expect(screen.getByText(/Monthly history:/).textContent).toBe("Monthly history: month=2026-11&account=fixture&page=2");
  expect(screen.queryByText(/weekly|classification|allowance|target/i)).toBeNull();
});
