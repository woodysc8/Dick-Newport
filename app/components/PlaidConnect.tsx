"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import Script from "next/script";

type LinkTokenResponse = {
  link_token?: string;
  expiration?: string;
  credential_session?: string;
};

export type PlaidLinkToken = { token: string; expiration: string; credentialSession: string };

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
    failed_stages?: string[];
  }>;
};

export async function requestPlaidLinkToken(product = "transactions"): Promise<PlaidLinkToken> {
  const response = await fetch("/api/plaid/create-link-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ product }) });
  const data = (await response.json()) as LinkTokenResponse & { error?: string };
  if (!response.ok || !data.link_token || !data.expiration || !data.credential_session) {
    throw new Error(data.error ?? "Unable to prepare Plaid connection. Check personal credentials in Settings.");
  }
  return { token: data.link_token, expiration: data.expiration, credentialSession: data.credential_session };
}

export async function exchangePlaidPublicToken(publicToken: string, credentialSession: string): Promise<void> {
  const response = await fetch("/api/plaid/exchange-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_token: publicToken, credential_session: credentialSession }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Unable to save Plaid connection");
}

export async function requestPlaidRefresh(): Promise<RefreshResponse> {
  const response = await fetch("/api/plaid/refresh", { method: "POST" });
  let data: RefreshResponse & { error?: string };
  try { data = await response.json(); }
  catch { throw new Error("Refresh returned an unreadable response. Your saved connections are unchanged. Retry refresh."); }
  if (!data || typeof data !== "object") throw new Error("Refresh returned an invalid response. Retry refresh.");
  if (!response.ok) throw new Error(data.error ?? "Unable to refresh Plaid connections");
  if (!["completed", "in_progress"].includes(data.status) || !Array.isArray(data.items)) throw new Error("Refresh returned an invalid response. Retry refresh.");
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
    const stages = [...new Set(data.items.flatMap(item => item.failed_stages ?? []))]
      .filter(stage => ["ownership", "token_decryption", "accounts", "transactions", "investments"].includes(stage));
    return {
      message: failedItems > 0
        ? `Refresh completed with ${failedItems} connection${failedItems === 1 ? "" : "s"} needing attention${stages.length ? ` (${stages.join(", ")})` : ""}. Retry refresh; check personal credential and product access in Settings if it persists.`
        : "Refresh completed with errors.",
      error: true,
    };
  }
  return { message: `Financial data refreshed (${changes} transaction changes).`, error: false };
}

export default function PlaidConnect() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<PlaidLinkToken | null>(null);
  const [product, setProduct] = useState("transactions");
  const session = useRef("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLinkOpen, setIsLinkOpen] = useState(false);
  const tokenRequestInFlight = useRef(false);
  const linkOpenInProgress = useRef(false);
  const mutationInFlight = useRef(false);
  const exchanged = useRef(false);
  const [scriptReady, setScriptReady] = useState(false);
  const savedConnection = useRef(false);

  const refreshAfterExchange = useCallback(async () => {
    const data = await requestPlaidRefresh();
    const summary = refreshSummary(data);
    setStatus(`${savedConnection.current ? "Connection saved. " : ""}${summary.message}`);
    setError(summary.error ? summary.message : null);
    if (data.status === "completed") {
      window.dispatchEvent(new Event("financial-data-refreshed"));
      router.refresh();
    }
  }, [router]);

  const createLinkToken = async () => {
    if (tokenRequestInFlight.current || mutationInFlight.current || linkOpenInProgress.current || isLoading) return;
    tokenRequestInFlight.current = true;
    setIsLoading(true);
    setError(null);
    setStatus("Preparing a secure Plaid connection...");
    try {
      const token = await requestPlaidLinkToken(product);
      session.current = token.credentialSession;
      exchanged.current = false;
      setLinkToken(token);
      setStatus("Ready to connect.");
    } catch (error) {
      setStatus("Could not prepare a Plaid connection.");
      setError(error instanceof Error ? error.message : "Check your personal credentials in Settings.");
    } finally {
      tokenRequestInFlight.current = false;
      setIsLoading(false);
    }
  };

  const onSuccess = useCallback(async (publicToken: string | null) => {
    if (exchanged.current || mutationInFlight.current) return;
    exchanged.current = true;
    linkOpenInProgress.current = false;
    setIsLinkOpen(false);
    setLinkToken(null);
    if (!publicToken) {
      setStatus("Plaid did not complete the connection.");
      setError("Plaid did not return a public token.");
      return;
    }
    setIsLoading(true);
    mutationInFlight.current = true;
    setError(null);
    setStatus("Saving your secure connection...");
    try {
      await exchangePlaidPublicToken(publicToken, session.current);
      savedConnection.current = true;
      if (product === "investments") {
        setStatus("Connection saved. Open Investments to verify permission and choose Sync holdings. No financial sync was started.");
        router.refresh();
        return;
      }
      setStatus("Connection saved. Refreshing financial data...");
      try { await refreshAfterExchange(); }
      catch (error) {
        setStatus("Connection saved. Financial data could not be refreshed.");
        setError(error instanceof Error ? error.message : "Retry refresh using the saved connection.");
      }
    } catch {
      setStatus("Plaid returned successfully, but the connection could not be completed.");
      setError("Refresh saved connections before starting another attempt. The save result could not be confirmed.");
    } finally {
      setIsLoading(false);
      mutationInFlight.current = false;
    }
  }, [refreshAfterExchange, product, router]);

  const onExit = useCallback((linkError: { error_code: string } | null) => {
    if (exchanged.current) return;
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

  const openLink = (open: () => void, ready: boolean) => {
    if (!linkToken || !ready || isLoading || linkOpenInProgress.current || mutationInFlight.current) return;
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

  const retryRefresh = async () => {
    if (mutationInFlight.current || tokenRequestInFlight.current || linkOpenInProgress.current || linkToken) return;
    mutationInFlight.current = true;
    setIsLoading(true);
    setError(null);
    setStatus("Refreshing saved connections...");
    try { await refreshAfterExchange(); }
    catch (error) {
      setStatus("Saved connections are unchanged. Refresh failed.");
      setError(error instanceof Error ? error.message : "Unable to refresh. Retry shortly.");
    } finally { mutationInFlight.current = false; setIsLoading(false); }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-ink)]">Connected accounts</p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">Plaid connections stay separate from manually entered accounts.</p>
      <a className="mt-2 block text-xs underline" href="/settings/profile">Manage personal Plaid credentials</a>
      <label className="mt-2 block text-xs">Connection product <select value={product} disabled={isLoading || !!linkToken} onChange={event => setProduct(event.target.value)}><option value="transactions">Transactions and balances</option><option value="investments">Investments and balances</option></select></label>
      <div className="mt-3 flex flex-wrap gap-2">
        {linkToken && <Script id="personal-plaid-link-sdk" src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" strategy="afterInteractive" onReady={() => setScriptReady(true)} onError={() => { setLinkToken(null); setError("Plaid Link could not load. Retry connecting."); }} />}
        {!linkToken ? (
          <button id="plaid-connect-button" onClick={createLinkToken} disabled={isLoading} className="rounded border border-[var(--border)] px-3 py-2 text-sm font-medium disabled:opacity-50">
            {isLoading ? "Preparing..." : "Connect a bank"}
          </button>
        ) : scriptReady ? <PlaidSession token={linkToken.token} onSuccess={onSuccess} onExit={onExit} onEvent={onEvent} onOpen={openLink} disabled={isLoading || isLinkOpen} /> : <button disabled>Loading Plaid...</button>}
        <button type="button" onClick={retryRefresh} disabled={isLoading || isLinkOpen || !!linkToken} className="rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50">Refresh saved connections</button>
      </div>
      {status && <p className="mt-2 text-xs text-[var(--text-muted)]" role="status">{status}</p>}
      {error && <p className="mt-2 text-xs text-red-600" role="alert">{error}</p>}
    </div>
  );
}

// Mount the SDK hook only after Next Script's cached loader has finished.
// This avoids react-plaid-link removing/reinserting an in-flight script in Strict Mode.
function PlaidSession({ token, onSuccess, onExit, onEvent, onOpen, disabled }: {
  token: string;
  onSuccess: (token: string | null) => void;
  onExit: (error: { error_code: string } | null) => void;
  onEvent: (name: string, metadata: { error_code: string | null }) => void;
  onOpen: (open: () => void, ready: boolean) => void;
  disabled: boolean;
}) {
  const { open, ready } = usePlaidLink({ token, onSuccess, onExit, onEvent });
  return <button id="plaid-connect-button" onClick={() => onOpen(open, ready)} disabled={!ready || disabled} className="rounded bg-black px-3 py-2 text-sm text-white disabled:opacity-50">Open Plaid</button>;
}
