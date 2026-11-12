// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FinancialReport from "./FinancialReport";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("clearly labels unsaved previews and updates saved-record reads without writing", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: null, history: [], storageEnabled: false, scheduleEnabled: false, report: { generatedAt: "2026-11-12T15:00:00Z", sections: [{ title: "Purchase history", lines: ["Purchase history unavailable"] }] } }) });
  vi.stubGlobal("fetch", fetcher); render(<FinancialReport />);
  await screen.findByText("Purchase history unavailable");
  expect(screen.getByText(/Unsaved preview\. Update report/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download Word" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save update preferences" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Update report" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls[1][0]).toBe("/api/financial-report?preview=true");
  expect(fetcher.mock.calls[1][1].method).toBeUndefined();
});
