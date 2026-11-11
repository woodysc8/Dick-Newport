// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PersonalPlaidCredentials from "./PersonalPlaidCredentials";

const fetchMock = vi.fn<typeof fetch>();
const absent = () => Response.json({ configured: false });
const active = () => Response.json({ configured: true, environment: "production", status: "active", verifiedAt: "2026-11-11T20:00:00Z" });
beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function start() {
  render(<PersonalPlaidCredentials />);
  await waitFor(() => expect((screen.getByRole("button", { name: "Save credentials" }) as HTMLButtonElement).disabled).toBe(false));
}
function fill() {
  fireEvent.change(screen.getByLabelText("Client ID"), { target: { value: "a".repeat(24) } });
  fireEvent.change(screen.getByLabelText("API secret"), { target: { value: "b".repeat(30) } });
  fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "production" } });
}

describe("Personal Plaid Credentials Settings", () => {
  it("reproduces an empty mutation response and shows a recoverable error instead of a native JSON exception", async () => {
    fetchMock.mockResolvedValueOnce(absent()).mockResolvedValueOnce(new Response(null, { status: 502 })).mockResolvedValueOnce(absent());
    await start(); fill(); fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("empty response (HTTP 502)"));
    expect(screen.getByRole("status").textContent).not.toMatch(/Unexpected end|execute 'json'|SyntaxError/);
    expect((screen.getByLabelText("API secret") as HTMLInputElement).value).toBe("");
  });

  it("loads cleanly, saves, verifies, deletes and refreshes status without retrieving secrets", async () => {
    fetchMock.mockResolvedValueOnce(absent()).mockResolvedValueOnce(active()).mockResolvedValueOnce(active()).mockResolvedValueOnce(absent()).mockResolvedValueOnce(absent());
    await start(); fill(); fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));
    await screen.findByRole("button", { name: "Replace credentials" });
    await waitFor(() => expect((screen.getByRole("button", { name: "Verify credentials" }) as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByLabelText("API secret") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Verify credentials" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Credentials verified"));
    fireEvent.click(screen.getByRole("button", { name: "Delete credentials" }));
    await screen.findByRole("button", { name: "Save credentials" });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Credentials deleted"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST", body: JSON.stringify({ action: "verify" }) });
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock.mock.calls[3][1]?.body).toBeUndefined();
  });

  it("recovers from an empty initial load through a status refresh", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })).mockResolvedValueOnce(absent());
    render(<PersonalPlaidCredentials />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("empty response"));
    expect((screen.getByRole("button", { name: "Save credentials" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save credentials" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("does not retry a mutation after an ambiguous response and reconciles saved status", async () => {
    fetchMock.mockResolvedValueOnce(absent()).mockResolvedValueOnce(new Response("{", { status: 200, headers: { "Content-Type": "application/json" } })).mockResolvedValueOnce(active());
    await start(); fill(); fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));
    await screen.findByRole("button", { name: "Replace credentials" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toContain("Status refreshed");
    expect(screen.getByRole("status").textContent).not.toContain("Credentials saved and verified");
  });

  it("locks mutations when recovery status also fails", async () => {
    fetchMock.mockResolvedValueOnce(absent()).mockRejectedValueOnce(new TypeError("sensitive network detail")).mockResolvedValueOnce(new Response("<html>upstream failure</html>", { status: 502 }));
    await start(); fill(); fireEvent.click(screen.getByRole("button", { name: "Save credentials" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect((screen.getByRole("button", { name: "Save credentials" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole("status").textContent).not.toContain("sensitive network detail");
  });

  it("shows session expiry on initial load without enabling mutations", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Authentication required" }, { status: 401 }));
    render(<PersonalPlaidCredentials />);
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Sign in and retry"));
    expect((screen.getByRole("button", { name: "Save credentials" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("API secret") as HTMLInputElement).value).toBe("");
  });

  it("preserves the delete recovery action after a failed verification reveals pending revocation", async () => {
    fetchMock.mockResolvedValueOnce(active()).mockResolvedValueOnce(Response.json({ error: "pending revocation" }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ configured: true, environment: "production", status: "revoking", verifiedAt: null }));
    render(<PersonalPlaidCredentials />);
    await waitFor(() => expect((screen.getByRole("button", { name: "Verify credentials" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Verify credentials" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("awaiting deletion"));
    expect((screen.getByRole("button", { name: "Verify credentials" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Replace credentials" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete credentials" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
