// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import SuggestedClassifications from "./SuggestedClassifications";

const account = { id: "00000000-0000-4000-8000-000000000001", account_name: "Checking", institution_name: "Fixture", currency: "USD" };
function response(url: string) {
  const page = Number(new URL(url, "http://localhost").searchParams.get("page") ?? 1);
  return Response.json({
    summary: { total: 239, alreadyReviewed: 0, high: 0, medium: 40, ambiguous: 199, missingProviderMetadata: 239 },
    matching: 239, page, hasMore: page === 1, accounts: [account],
    suggestions: [{
      transaction: { id: "fixture", account_id: account.id, date: "2026-11-12", name: `Dinner page ${page}`, merchant_name: null, amount: 20, pending: false, category: "Food and Drink > Restaurants", normalized_category: "needs_review", category_override: null, transaction_currency: "USD" },
      suggestion: { category: "dining", confidence: "medium", evidence: "legacy_plaid", reason: "Exact legacy path; approval required.", weeklyIncludedByDefault: true, requiresApproval: true, movementRisk: null },
      weekly: { kind: "include", reason: "Hypothetical purchase." }, monthly: { kind: "include", reason: "Hypothetical purchase." },
    }],
  });
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("displays stored and suggested categories, scope counts, reasons and hypothetical effects without saving", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => response(String(url)));
  render(<SuggestedClassifications />);
  await screen.findByRole("heading", { name: "Dinner page 1" });
  expect(screen.getByRole("heading", { name: "Suggested classifications" })).toBeTruthy();
  for (const label of ["Total transactions", "Already reviewed", "High-confidence suggestions", "Medium-confidence suggestions", "Still ambiguous", "Missing provider metadata"])
    expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByText(/Stored category:/).textContent).toContain("Needs review");
  expect(screen.getByText(/Suggested category:/).textContent).toContain("Restaurants, takeout & delivery");
  expect(screen.getByText(/Exact legacy path; approval required/)).toBeTruthy();
  expect(screen.getByText(/Explicit approval required; nothing saved/)).toBeTruthy();
  fireEvent.click(screen.getByText("Spending effect if explicitly approved"));
  expect(screen.getByText(/Weekly: include/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /save|approve/i })).toBeNull();
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][1]?.method).toBeUndefined();
});

it("sends confidence/category/account/review filters and pagination as authenticated GET requests", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => response(String(url)));
  render(<SuggestedClassifications />);
  await screen.findByRole("heading", { name: "Dinner page 1" });
  fireEvent.click(screen.getByRole("button", { name: "Next suggestions" }));
  await screen.findByRole("heading", { name: "Dinner page 2" });
  fireEvent.change(screen.getByLabelText("Suggestion confidence"), { target: { value: "medium" } });
  fireEvent.change(screen.getByLabelText("Proposed category"), { target: { value: "dining" } });
  fireEvent.change(screen.getByLabelText("Suggestion account"), { target: { value: account.id } });
  fireEvent.change(screen.getByLabelText("Current review status"), { target: { value: "unreviewed" } });
  fireEvent.click(screen.getByRole("button", { name: "Filter suggestions" }));
  await screen.findByRole("heading", { name: "Dinner page 1" });
  const params = new URL(String(fetcher.mock.calls.at(-1)![0]), "http://localhost").searchParams;
  expect(params.get("suggestion_confidence")).toBe("medium");
  expect(params.get("proposed_category")).toBe("dining");
  expect(params.get("account")).toBe(account.id);
  expect(params.get("review_status")).toBe("unreviewed");
  expect(params.has("page")).toBe(false);
  expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
});

it("keeps read failures visible and retries without reporting an empty dataset or sync freshness", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }))
    .mockImplementation(async (url) => response(String(url)));
  render(<SuggestedClassifications />);
  await screen.findByRole("alert");
  expect(screen.queryByText("Total transactions")).toBeNull();
  expect(screen.getByText(/does not verify Plaid freshness/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry suggestions" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  await screen.findByRole("heading", { name: "Dinner page 1" });
  expect(fetcher).toHaveBeenCalledTimes(2);
});
