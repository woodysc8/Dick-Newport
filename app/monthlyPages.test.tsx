// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<{ href: string }>) => <a {...props}>{children}</a> }));
vi.mock("../lib/supabase/server", () => ({ getAuthenticatedSupabaseContext: mocks.auth }));
vi.mock("./components/FinancePage", () => ({ Shell: ({ children }: React.PropsWithChildren) => <main>{children}</main> }));
vi.mock("./components/MonthlyTransactions", () => ({ default: ({ initialQuery }: { initialQuery: string }) => <div>Monthly history: {initialQuery}</div> }));
import TransactionsPage from "./transactions/page";
import Home from "./page";
import BudgetPage from "./budget/page";
import FinanceNav from "./components/FinanceNav";
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("makes Transactions the landing page and retires the budget route", () => {
  expect(() => Home()).toThrow("redirect:/transactions");
  expect(() => BudgetPage()).toThrow("redirect:/transactions");
});
it("has no budget navigation and puts Transactions first", () => {
  render(<FinanceNav active="Transactions" />);
  expect(screen.getAllByRole("link")[0].getAttribute("href")).toBe("/transactions");
  expect(screen.queryByRole("link", { name: /budget|overview/i })).toBeNull();
});
it("authenticates monthly history and mounts only the monthly interface", async () => {
  mocks.auth.mockResolvedValueOnce(null);
  await expect(TransactionsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/login");
  mocks.auth.mockResolvedValueOnce({ user: { id: "owner" } });
  render(await TransactionsPage({ searchParams: Promise.resolve({ month: "2026-11", account: "fixture", page: "2", category: "needs_review" }) }));
  expect(screen.getByText(/Monthly history:/).textContent).toBe("Monthly history: month=2026-11&account=fixture&page=2");
  expect(screen.queryByText(/weekly|classification|allowance|target/i)).toBeNull();
});
