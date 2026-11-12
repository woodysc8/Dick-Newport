"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import Script from "next/script";
import { holdingStatusMessage } from "../../lib/investmentHoldingState";
import { exchangePlaidPublicToken } from "./PlaidConnect";

type Connection = { id: string; institution: string; active: boolean; permissionRecorded: boolean; accounts: { id: string; name: string; subtype: string | null; status: string; syncedAt: string | null }[] };
type Status = { setupRequired: boolean; connections: Connection[] };
type Session = { link_token: string; expiration: string; credential_session: string; mode: "update" | "separate" };
const oauthKey = "dick-newport-holdings-oauth";
async function request(path: string, body?: Record<string, unknown>) {
  const response = await fetch(path, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Holdings request unavailable. Retry later.");
  return result;
}
export default function InvestmentHoldingsControls() {
  const router = useRouter();
  const [data, setData] = useState<Status | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [session, setSession] = useState<Session | null>(null), [scriptReady, setScriptReady] = useState(false), [redirectUri, setRedirectUri] = useState<string | undefined>();
  const completed = useRef(false), inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    void request("/api/plaid/holdings").then((result) => {
      if (!active) return;
      setData(result);
      if (new URL(window.location.href).searchParams.has("oauth_state_id")) {
        try {
          const saved = JSON.parse(sessionStorage.getItem(oauthKey) ?? "null");
          if (saved?.link_token && saved?.credential_session && ["update", "separate"].includes(saved.mode) && Date.parse(saved.expiration) > Date.now()) { setSession(saved); setRedirectUri(window.location.href); }
          else setError("Consent session expired. Start Enable holdings again.");
        } catch { setError("Consent session unavailable. Start Enable holdings again."); }
      }
    }).catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);
  async function run(work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Holdings request unavailable. Retry later."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  const reload = async () => { setData(await request("/api/plaid/holdings")); router.refresh(); };
  const enable = (id: string, mode: "update" | "separate") => run(async () => {
    const token = await request("/api/plaid/create-investment-update-link-token", { connection_id: id, mode });
    if (!token.link_token || !token.credential_session || Date.parse(token.expiration) <= Date.now()) throw new Error("Consent session unavailable. Retry Enable holdings.");
    completed.current = false; setSession(token); setRedirectUri(undefined); setMessage("Open Plaid to grant Investments access. Holdings will not be fetched automatically.");
  });
  const success = (publicToken: string | null) => {
    if (!session || completed.current) return;
    completed.current = true;
    const active = session; setSession(null); sessionStorage.removeItem(oauthKey);
    void run(async () => {
      if (active.mode === "update") {
        const result = await request("/api/plaid/holdings", { action: "verify", credential_session: active.credential_session });
        if (!result.authorized || result.transactionsPermissionMissing) setError(result.message); else setMessage(result.message);
      } else {
        if (!publicToken) throw new Error("No new connection was returned. Existing connections are unchanged.");
        await exchangePlaidPublicToken(publicToken, active.credential_session);
        setMessage("Separate connection saved. Check its recorded permission below, then choose Sync holdings. Existing connections remain intact; no sync was started.");
      }
      await reload();
    });
  };
  const button = "rounded border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50";
  return <section aria-label="Holdings access" className="mb-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
    <h2 className="text-xl font-semibold">Holdings access</h2>
    <p className="mt-2 text-sm text-[var(--text-muted)]">Enable holdings requests consent. Keep your existing account and Transactions permissions selected in Link. Sync holdings imports Plaid’s latest available positions only when you choose it. It does not refresh transactions, initiate trades or promise real-time prices. Crypto coverage depends on the accounts Plaid returns.</p>
    {data?.setupRequired && <p className="mt-3 text-sm">Holdings sync awaits approval and application of the local migration. Existing balances and connections remain available.</p>}
    {data?.connections.map((c) => <div key={c.id} className="mt-4 border-t border-[var(--border)] pt-4">
      <h3 className="font-medium">{c.institution}</h3><p className="mt-1 text-xs">{c.permissionRecorded ? "Investments permission recorded; Sync holdings rechecks Plaid authorization." : "Investments permission required or not yet verified."}</p>
      {c.accounts.map((a) => <p key={a.id} className="mt-2 text-sm">{a.name} · {a.subtype ?? "Type unavailable"}<small className="block text-[var(--text-muted)]">{holdingStatusMessage(a.status, a.syncedAt)}</small></p>)}
      <div className="mt-3 flex flex-wrap gap-3"><button className={button} disabled={busy || !!session || !c.active} onClick={() => void enable(c.id, "update")}>Enable holdings</button><button className={button} disabled={busy || !!session || !c.active || !c.permissionRecorded || data.setupRequired} onClick={() => void run(async () => {
        const result = await request("/api/plaid/holdings", { action: "sync", connection_id: c.id, approved: true });
        if (!result.success) setError(result.message); else { setMessage(result.message); window.dispatchEvent(new Event("financial-data-refreshed")); }
        await reload();
      })}>Sync holdings</button></div>
      <details className="mt-3 text-sm"><summary className="cursor-pointer">Upgrade unavailable?</summary><p className="my-2">A separate Investments connection preserves the existing transactions connection and may incur an additional Plaid subscription. Availability is checked in Link. Duplicate account coverage can make net worth unavailable until reconciled.</p><button className={button} disabled={busy || !!session || !c.active} onClick={() => void enable(c.id, "separate")}>Add separate investment connection</button></details>
      {!c.active && <p className="mt-2 text-sm">Reauthorization is required. Check saved credentials in Settings.</p>}
    </div>)}
    {session && <><Script id="holdings-plaid-sdk" src="https://cdn.plaid.com/link/v2/stable/link-initialize.js" strategy="afterInteractive" onReady={() => setScriptReady(true)} onError={() => { setSession(null); setError("Plaid Link failed to load. Retry Enable holdings."); }} />{scriptReady ? <HoldingsConsentLink session={session} receivedRedirectUri={redirectUri} onSuccess={success} onExit={() => { if (completed.current) return; setSession(null); sessionStorage.removeItem(oauthKey); setMessage("Consent closed. Existing connection and holdings are unchanged. Retry Enable holdings when ready."); }} onOAuth={() => { try { sessionStorage.setItem(oauthKey, JSON.stringify(session)); } catch { setError("OAuth recovery storage is unavailable. Return to Investments and retry if redirected."); } }} /> : <p className="mt-3 text-sm">Loading secure consent…</p>}</>}
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}{error && <p role="alert" className="mt-3 text-sm">{error}</p>}
    <a href="/settings/profile" className="mt-3 inline-block text-sm underline">Plaid credential settings</a>
  </section>;
}
function HoldingsConsentLink({ session, receivedRedirectUri, onSuccess, onExit, onOAuth }: { session: Session; receivedRedirectUri?: string; onSuccess: (token: string | null) => void; onExit: () => void; onOAuth: () => void }) {
  const opened = useRef(false);
  const { open, ready } = usePlaidLink({ token: session.link_token, receivedRedirectUri, onSuccess, onExit, onEvent: (event) => { if (event === "OPEN_OAUTH") onOAuth(); } });
  return <button className="mt-3 rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50" disabled={!ready} onClick={() => { if (opened.current) return; if (Date.parse(session.expiration) <= Date.now()) { onExit(); return; } opened.current = true; try { open(); } catch { opened.current = false; onExit(); } }}>{receivedRedirectUri ? "Continue consent" : "Open Plaid"}</button>;
}
