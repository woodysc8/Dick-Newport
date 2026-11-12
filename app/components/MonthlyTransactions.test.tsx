// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import MonthlyTransactions from "./MonthlyTransactions";
import { summarizeMonthlyActivity } from "../../lib/monthlyActivity";
import type { BudgetAccount, BudgetTransaction } from "../../lib/discretionaryBudget";

const account: BudgetAccount = { id: "00000000-0000-4000-8000-000000000001", account_name: "Checking", institution_name: "Fixture", currency: "USD", persistent_account_id: null, weekly_budget_source: "review", created_at: "2026-01-01" };
const row: BudgetTransaction = { id: "t", account_id: account.id, plaid_transaction_id: "t", date: "2026-11-12", name: "Venmo dinner", merchant_name: "Venmo", amount: 100, pending: false, category: "Transfer > Third Party > Venmo", normalized_category: "needs_review", category_override: null, weekly_budget_override: null, transaction_currency: "USD", pending_transaction_id: null, plaid_primary_category: null, plaid_detailed_category: null, plaid_category_confidence: null };
function response(url: string) {
  const params = new URL(url, "http://localhost").searchParams;
  const month = params.get("month") ?? "2026-11", page = Number(params.get("page") ?? 1);
  return Response.json({ ...summarizeMonthlyActivity([{ ...row, date: `${month}-12`, merchant_name: `Venmo page ${page}` }], [account], month, params.get("account")), page, hasMore: page === 1 });
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows a simple monthly purchase figure and transaction list without budgeting or suggestions", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => response(String(url)));
  render(<MonthlyTransactions />);
  await screen.findByText("Venmo page 1");
  expect(screen.getByRole("heading", { name: "Posted purchases · 2026-11" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Transactions this month" })).toBeTruthy();
  expect(screen.getByText("Provisional · includes unverified posted debits")).toBeTruthy();
  expect(screen.getByText(/Unverified posted debits included/).textContent).toContain("$100.00");
  expect(screen.getByText("Unverified debit")).toBeTruthy();
  const headings = within(screen.getByRole("table")).getAllByRole("columnheader").map((e) => e.textContent);
  expect(headings).toEqual(["Date", "Merchant", "Amount", "Account"]);
  expect(screen.queryByText(/weekly|allowance|suggested classifications|confidence|target/i)).toBeNull();
  expect(screen.queryByRole("button", { name: /save|approve|review/i })).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
});

it("paginates and resets to page one when the month/account changes using GET only", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => response(String(url)));
  render(<MonthlyTransactions />);
  await screen.findByText("Venmo page 1");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText("Venmo page 2");
  fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2026-10" } });
  fireEvent.change(screen.getByLabelText("Account"), { target: { value: account.id } });
  fireEvent.click(screen.getByRole("button", { name: "Show transactions" }));
  await screen.findByRole("heading", { name: "Posted purchases · 2026-10" });
  const params = new URL(String(fetcher.mock.calls.at(-1)![0]), "http://localhost").searchParams;
  expect(params.get("month")).toBe("2026-10");
  expect(params.get("account")).toBe(account.id);
  expect(params.has("page")).toBe(false);
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("keeps errors visible instead of claiming zero spending and supports a read-only retry", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ error: "Transaction data is unavailable" }, { status: 503 })).mockImplementation(async (url) => response(String(url)));
  render(<MonthlyTransactions />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("heading", { name: /Posted purchases/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByText("Venmo page 1");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("uses the same monthly endpoint for a six-row Overview preview with a full-history link", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const data = await response(String(url)).json();
    return Response.json({ ...data, rows: Array.from({ length: 8 }, (_, i) => ({ ...data.rows[0], id: String(i), merchant: `Preview merchant ${i}` })) });
  });
  render(<MonthlyTransactions preview />);
  await screen.findByRole("heading", { name: "Recent transactions" });
  expect(screen.queryByLabelText("Month")).toBeNull();
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(7);
  expect(screen.getByRole("link", { name: "View all transactions" }).getAttribute("href")).toBe("/transactions");
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  expect(String(fetcher.mock.calls[0][0])).toContain("/api/transactions?view=monthly");
});
