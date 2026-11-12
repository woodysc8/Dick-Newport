// @vitest-environment jsdom
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WeeklyBudget from "./WeeklyBudget";
import FinancialBriefing from "./FinancialBriefing";
import BudgetEngine from "./BudgetEngine";
import TransactionReview from "./TransactionReview";
import { weeklyMetrics } from "../../lib/discretionaryBudget";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("handles malformed successful JSON without crashing or claiming publish success", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({}));
  render(<FinancialBriefing />);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "status unavailable",
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview briefing" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "preview unavailable",
    ),
  );
  expect(
    screen.queryByText("Private document published successfully."),
  ).toBeNull();
});
it("does not present $420 as safely available when $527.26 needs review", async () => {
  const metrics = {
    ...weeklyMetrics([], [], 420),
    review: 527.26,
    reviewCount: 17,
    provisional: true,
    conservativeRemaining: -107.26,
  };
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ metrics, accounts: [] }),
  );
  render(<WeeklyBudget />);
  await waitFor(() =>
    expect(screen.getByText("Provisional — review required")).toBeTruthy(),
  );
  expect(
    screen.getByText(/This estimate is not a safe-to-spend/).textContent,
  ).toContain("-$107.26");
});
it("allows read-only preview with Google disabled and prevents publishing", async () => {
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      Response.json({
        configured: false,
        statusAvailable: false,
        status: [],
        nextScheduledRun: "Disabled",
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        preview: {
          text: "Private synthetic briefing",
          hash: "fixture",
          generatedAt: "2026-11-11",
        },
      }),
    );
  render(<FinancialBriefing />);
  await waitFor(() =>
    expect(screen.getByText(/Publishing disabled/)).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview briefing" }));
  await waitFor(() =>
    expect(screen.getByText("Private synthetic briefing")).toBeTruthy(),
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Publish to private Doc",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    action: "preview",
  });
});
it("shows a migration error rather than zero monthly spending", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ error: "Unavailable" }, { status: 503 }),
  );
  render(<BudgetEngine editable />);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("migration"),
  );
  expect(screen.queryByText("$0.00")).toBeNull();
});
it("review is read-only until the user selects and confirms corrections", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      before: { needs_review: 1 },
      after: { dining: 1 },
      scope: "Dry run",
      examples: [
        {
          id: "fixture",
          name: "Bagel Express",
          date: "2026-11-11",
          before: "needs_review",
          after: "dining",
          source: "merchant_rule",
          reason: "Narrow rule",
        },
      ],
    }),
  );
  render(<TransactionReview />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Preview reclassification (no writes)",
    }),
  );
  await waitFor(() => expect(screen.getByText(/Bagel Express/)).toBeTruthy());
  expect(
    (
      screen.getByRole("button", {
        name: "Save selected corrections",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
});
