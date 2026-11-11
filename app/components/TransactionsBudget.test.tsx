// @vitest-environment jsdom
import React from "react";
import { act } from "@testing-library/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TransactionsWorkspace from "./TransactionsWorkspace";
import WeeklyBudget from "./WeeklyBudget";
import {
  weeklyMetrics,
  type BudgetAccount,
  type BudgetTransaction,
} from "../../lib/discretionaryBudget";
const account: BudgetAccount = {
  id: "00000000-0000-4000-8000-000000000001",
  account_name: "Checking",
  institution_name: "Test",
  currency: "USD",
  persistent_account_id: null,
  weekly_budget_source: "include",
  created_at: "2026-01-01",
};
const row: BudgetTransaction = {
  id: "00000000-0000-4000-8000-000000000002",
  account_id: account.id,
  plaid_transaction_id: "synthetic",
  date: "2026-11-11",
  name: "Description",
  merchant_name: "Coffee",
  amount: -5,
  pending: false,
  category: null,
  normalized_category: "coffee",
  category_override: null,
  weekly_budget_override: null,
  transaction_currency: "USD",
  pending_transaction_id: null,
  plaid_primary_category: "FOOD_AND_DRINK",
  plaid_detailed_category: "FOOD_AND_DRINK_COFFEE",
  plaid_category_confidence: "HIGH",
};
const page = () =>
  Response.json({
    transactions: [row],
    accounts: [account],
    page: 1,
    hasMore: true,
  });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("refreshes the date-based week after local Monday begins without writing records", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-09T04:59:30Z"));
  const data = () =>
    Response.json({
      metrics: weeklyMetrics([], [account], 100, new Date()),
      accounts: [account],
    });
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => data());
  await act(async () => {
    render(<WeeklyBudget />);
  });
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(
    fetch.mock.calls.every(
      ([url, options]) => url === "/api/weekly-budget" && !options?.method,
    ),
  ).toBe(true);
});

it("updates transaction previews when saved connection refresh completes", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => page());
  render(<TransactionsWorkspace preview />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Details Coffee" })).toBeTruthy(),
  );
  fireEvent(window, new Event("financial-data-refreshed"));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});
it("shows loading, credit direction, provider detail, correction, and paginated filters", async () => {
  let resolve!: (r: Response) => void;
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(Response.json({ saved: true }))
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(page());
  render(<TransactionsWorkspace />);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  resolve(page());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Details Coffee" })).toBeTruthy(),
  );
  expect(screen.getAllByText("+$5.00 credit").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Details Coffee" }));
  const detail = screen.getByRole("region", { name: "Transaction details" });
  expect(detail.textContent).toContain("FOOD_AND_DRINK_COFFEE");
  fireEvent.change(within(detail).getByLabelText("Category correction"), {
    target: { value: "dining" },
  });
  fireEvent.change(within(detail).getByLabelText("Weekly budget inclusion"), {
    target: { value: "exclude" },
  });
  fireEvent.click(
    within(detail).getByRole("button", { name: "Save correction" }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
    id: row.id,
    category_override: "dining",
    weekly_budget_override: "exclude",
  });
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(String(fetch.mock.calls[3][0])).toContain("page=2"),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Apply filters",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.change(screen.getByLabelText("Search merchant or description"), {
    target: { value: "Coffee" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() =>
    expect(String(fetch.mock.calls[4][0])).toContain("q=Coffee"),
  );
  expect(String(fetch.mock.calls[4][0])).not.toContain("page=2");
});
it.each(["", "<html>gateway</html>", "{}"])(
  "shows safe transaction errors and retry for %s",
  async (body) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
      .mockResolvedValueOnce(
        Response.json({
          transactions: [],
          accounts: [],
          page: 1,
          hasMore: false,
        }),
      );
    render(<TransactionsWorkspace />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Transactions unavailable",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(screen.getByText(/No transactions match/)).toBeTruthy(),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  },
);
it("keeps a correction panel open with an actionable error after failed persistence", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(
      Response.json(
        { error: "Transaction not found for this user" },
        { status: 400 },
      ),
    );
  render(<TransactionsWorkspace />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Details Coffee" })).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Details Coffee" }));
  fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("not found"),
  );
  expect(
    screen.getByRole("region", { name: "Transaction details" }),
  ).toBeTruthy();
});
it("starts unset and saves a weekly limit separately from monthly settings", async () => {
  const data = {
    metrics: weeklyMetrics(
      [],
      [account],
      null,
      new Date("2026-11-11T17:00:00Z"),
    ),
    accounts: [account],
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json(data))
    .mockResolvedValueOnce(Response.json({ saved: true }))
    .mockResolvedValueOnce(
      Response.json({
        ...data,
        metrics: { ...data.metrics, limit: 120, remaining: 120 },
      }),
    );
  render(<WeeklyBudget editable />);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  await waitFor(() =>
    expect(screen.getByText(/No weekly limit configured/)).toBeTruthy(),
  );
  expect(
    (screen.getByLabelText("Weekly limit (USD)") as HTMLInputElement).value,
  ).toBe("");
  fireEvent.change(screen.getByLabelText("Weekly limit (USD)"), {
    target: { value: "120" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save weekly limit" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  expect(fetch.mock.calls[1][0]).toBe("/api/weekly-budget");
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
    weekly_limit: 120,
  });
});
it("shows migration/data failure without fabricating zero spending", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ error: "migration missing" }, { status: 503 }),
  );
  render(<WeeklyBudget />);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("unavailable"),
  );
  expect(screen.queryByText("$0.00")).toBeNull();
});
