"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";

type LinkTokenResponse = {
  link_token?: string;
  expiration?: string;
};

export type PlaidLinkToken = { token: string; expiration: string };

const PLAID_EVENT_NAMES = new Set([
  "OPEN",
  "EXIT",
  "HANDOFF",
  "SELECT_INSTITUTION",
  "ERROR",
  "BANK_INCOME_INSIGHTS_COMPLETED",
  "IDENTITY_MATCH_FAILED",
  "IDENTITY_MATCH_PASSED",
  "IDENTITY_VERIFICATION_PASS_SESSION",
  "IDENTITY_VERIFICATION_FAIL_SESSION",
  "LAYER_READY",
  "LAYER_NOT_AVAILABLE",
  "LAYER_AUTOFILL_NOT_AVAILABLE",
]);

export function isPlaidLinkTokenExpired(expiration: string, now = Date.now()): boolean {
  const expiresAt = Date.parse(expiration);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

export function safePlaidCode(code: string | null | undefined): string | null {
  return code && /^[A-Z0-9_]{1,64}$/.test(code) ? code : null;
}

export type RefreshResponse = {
  success: boolean;
  status: "completed" | "in_progress";
  items: Array<{
    institution: string;
    plaid_item_id: string;
    status: "success" | "error";
    accounts_updated: number;
    accounts_created: number;
    transactions_added: number;
    transactions_modified: number;
    transactions_removed: number;
    holdings_updated: number;
    holdings_removed: number;
    error_count: number;
    warning_count: number;
  }>;
};

export async function requestPlaidLinkToken(): Promise<PlaidLinkToken> {
  const response = await fetch("/api/plaid/create-link-token", { method: "POST" });
  const data = (await response.json()) as LinkTokenResponse & { error?: string };
  if (!response.ok || !data.link_token || !data.expiration) {
    throw new Error("Unable to prepare Plaid connection. Please try again.");
  }
  return { token: data.link_token, expiration: data.expiration };
}

export async function exchangePlaidPublicToken(publicToken: string): Promise<void> {
  const response = await fetch("/api/plaid/exchange-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_token: publicToken }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Unable to save Plaid connection");
}

export async function requestPlaidRefresh(): Promise<RefreshResponse> {
  const response = await fetch("/api/plaid/refresh", { method: "POST" });
  const data = (await response.json()) as RefreshResponse & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Unable to refresh Plaid connections");
  return data;
}

export function openPlaidLink(open: () => void, ready: boolean): void {
  if (ready) open();
}

export function PlaidConnectShortcut() {
  return (
    <button
      type="button"
      onClick={() => document.getElementById("plaid-connect-button")?.click()}
      className="mt-4 inline-block rounded border border-[var(--border)] px-3 py-2 text-sm font-medium"
    >
      Connect a bank
    </button>
  );
}

function refreshSummary(data: RefreshResponse): { message: string; error: boolean } {
  if (data.status === "in_progress") return { message: "A refresh is already in progress.", error: false };
  const failedItems = data.items.filter((item) => item.status === "error").length;
  const changes = data.items.reduce(
    (total, item) => total + item.transactions_added + item.transactions_modified + item.transactions_removed,
    0,
  );
  if (!data.success || failedItems > 0) {
    return {
      message: failedItems > 0
        ? `Refresh completed with ${failedItems} connection${failedItems === 1 ? "" : "s"} needing attention.`
        : "Refresh completed with errors.",
      error: true,
    };
  }
  return { message: `Financial data refreshed (${changes} transaction changes).`, error: false };
}

export default function PlaidConnect() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<PlaidLinkToken | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const tokenRequestInFlight = useRef(false);
  const linkOpenInProgress = useRef(false);

  const refreshAfterExchange = useCallback(async () => {
    const data = await requestPlaidRefresh();
    const summary = refreshSummary(data);
    setStatus(summary.message);
    setError(summary.error ? summary.message : null);
    if (!summary.error && data.status === "completed") router.refresh();
  }, [router]);

  const createLinkToken = async () => {
    if (tokenRequestInFlight.current || isLoading) return;
    tokenRequestInFlight.current = true;
    setIsLoading(true);
    setError(null);
    setStatus("Preparing a secure Plaid connection...");
    try {
      setLinkToken(await requestPlaidLinkToken());
      setStatus("Ready to connect.");
    } catch {
      setStatus("Could not prepare a Plaid connection.");
      setError("Please try again. If the problem continues, contact support.");
    } finally {
      tokenRequestInFlight.current = false;
      setIsLoading(false);
    }
  };

  const onSuccess = useCallback(async (publicToken: string | null) => {
    linkOpenInProgress.current = false;
    setIsLinkOpen(false);
    setLinkToken(null);
    if (!publicToken) {
      setStatus("Plaid did not complete the connection.");
      setError("Plaid did not return a public token.");
      return;
    }
    setIsLoading(true);
    setError(null);
    setStatus("Saving your secure connection...");
    try {
      await exchangePlaidPublicToken(publicToken);
      setStatus("Connection saved. Refreshing financial data...");
      await refreshAfterExchange();
    } catch {
      setStatus("Plaid returned successfully, but the connection could not be completed.");
      setError("Please start a new attempt. If the problem continues, contact support.");
    } finally {
      setIsLoading(false);
    }
  }, [refreshAfterExchange]);

  const onExit = useCallback((linkError: { error_code: string } | null) => {
    linkOpenInProgress.current = false;
    setIsLinkOpen(false);
    setLinkToken(null);
    setIsLoading(false);
    setError(null);
    const code = safePlaidCode(linkError?.error_code);
    setStatus(code
      ? `Plaid ended the connection (${code}). Start another attempt to try again.`
      : "Connection closed before completion. Start another attempt to try again.");
  }, []);

  const onEvent = useCallback((eventName: string, metadata: { error_code: string | null }) => {
    if (!PLAID_EVENT_NAMES.has(eventName)) return;
    const code = safePlaidCode(metadata.error_code);
    // Deliberately record only allow-listed event names and sanitized error codes.
    console.info("Plaid Link event", code ? { eventName, errorCode: code } : { eventName });
  }, []);

  const { open, ready } = usePlaidLink({ token: linkToken?.token ?? null, onSuccess, onExit, onEvent });

  const openLink = () => {
    if (!linkToken || !ready || isLoading || linkOpenInProgress.current) return;
    if (isPlaidLinkTokenExpired(linkToken.expiration)) {
      setLinkToken(null);
      setStatus("This Plaid session expired. Start another attempt to get a fresh session.");
      setError(null);
      return;
    }
    linkOpenInProgress.current = true;
    setIsLinkOpen(true);
    setError(null);
    setStatus("Opening Plaid Link...");
    try {
      openPlaidLink(open, ready);
    } catch {
      linkOpenInProgress.current = false;
      setIsLinkOpen(false);
      setLinkToken(null);
      setStatus("Plaid could not be opened.");
      setError("Start another attempt to try again.");
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-ink)]">Connected accounts</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Plaid connections stay separate from manually entered accounts.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!linkToken ? (
          <button id="plaid-connect-button" onClick={createLinkToken} disabled={isLoading} className="rounded border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-50">
            {isLoading ? "Preparing..." : "Connect a bank"}
          </button>
        ) : (
          <button id="plaid-connect-button" onClick={openLink} disabled={!ready || isLoading || isLinkOpen} className="rounded bg-black px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            {isLoading ? "Processing..." : isLinkOpen ? "Plaid is open" : "Open Plaid"}
          </button>
        )}
      </div>
      {status && <p className="mt-2 text-xs text-[var(--text-muted)]" role="status">{status}</p>}
      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}
