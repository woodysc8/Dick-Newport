"use client";

import { useEffect, useRef, useState } from "react";
import { CredentialResponseError, requestCredentialStatus, type CredentialAction, type CredentialStatus } from "../../lib/plaidCredentialApi";

export default function PersonalPlaidCredentials() {
  const [saved, setSaved] = useState<CredentialStatus>({ configured: false });
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [environment, setEnvironment] = useState("sandbox");
  const [message, setMessage] = useState("Loading credential status…");
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    requestCredentialStatus(undefined, undefined, controller.signal).then(data => {
      if (active) { setSaved(data); setLoaded(true); if (data.environment) setEnvironment(data.environment); setMessage(""); }
    }).catch(error => { if (active) setMessage(error instanceof CredentialResponseError ? error.message : "Unable to load credential status. Please retry."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; controller.abort(); };
  }, []);

  async function refreshStatus() {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const data = await requestCredentialStatus();
      setSaved(data); setLoaded(true);
      if (data.environment) setEnvironment(data.environment);
      setMessage("Credential status refreshed.");
    } catch (error) {
      setLoaded(false);
      setMessage(error instanceof CredentialResponseError ? error.message : "Unable to load credential status. Please retry.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function manage(action: CredentialAction) {
    if (busy || !loaded || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    const input = { clientId, secret, environment };
    // Clear sensitive input as soon as the request starts. Never persist it locally.
    setSecret("");
    setClientId("");
    try {
      const data = await requestCredentialStatus(action, input);
      setSaved(data);
      setLoaded(true);
      setMessage(action === "verify" ? "Credentials verified. Product access is checked when connecting." : action === "delete" ? "Credentials deleted and connections revoked. Historical records were preserved." : "Credentials saved and verified. You can now connect institutions.");
    } catch (error) {
      const message = error instanceof CredentialResponseError ? error.message : "Unable to complete the credential request. Refresh status before retrying.";
      setLoaded(false);
      setMessage(message);
      // A lost response does not mean a mutation failed. Reconcile; never resend it.
      try {
        const data = await requestCredentialStatus();
        setSaved(data); setLoaded(true);
        if (data.environment) setEnvironment(data.environment);
        setMessage(`${message} Status refreshed: ${data.configured ? `credentials ${data.status === "revoking" ? "are awaiting deletion" : "are saved"}` : "no credentials are saved"}.`);
      } catch { setMessage(`${message} Status could not be confirmed. Use Refresh status before another operation.`); }
    } finally { inFlight.current = false; setBusy(false); }
  }

  const field = "mt-1 block w-full rounded border border-[var(--border)] bg-[var(--bg)] p-2";
  return <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-6">
    <h2 className="text-xl font-semibold">Personal Plaid Credentials</h2>
    <p className="mt-2 text-sm">Use your own Plaid developer account. Sandbox connects test institutions; Production requires your own approved access.</p>
    <p className="mt-2 text-sm">Connection status: {!loaded ? "Status unavailable" : saved.configured ? `${saved.environment} · ${saved.status}${saved.verifiedAt ? " · verified" : ""}` : "No credentials saved"}</p>
    <button className="mt-3 rounded border px-3 py-2 text-sm disabled:opacity-50" type="button" disabled={busy} onClick={() => void refreshStatus()}>Refresh status</button>
    <form onSubmit={event => { event.preventDefault(); void manage(saved.configured ? "replace" : "save"); }} className="mt-4 space-y-3">
      <label className="block text-sm">Client ID<input className={field} value={clientId} onChange={event => setClientId(event.target.value)} autoComplete="off" maxLength={24} required disabled={busy} /></label>
      <label className="block text-sm">API secret<input className={field} type="password" value={secret} onChange={event => setSecret(event.target.value)} autoComplete="new-password" maxLength={128} required disabled={busy} placeholder="Enter a new secret" /></label>
      <label className="block text-sm">Environment<select className={field} value={environment} onChange={event => setEnvironment(event.target.value)} disabled={busy}><option value="sandbox">Sandbox</option><option value="production">Production</option></select></label>
      <p className="text-sm text-[var(--text-muted)]">Replacement and deletion revoke all dependent connections. Reconnect afterward. Accounts, transactions, and investment history remain saved. A saved secret is never shown here.</p>
      <div className="flex flex-wrap gap-3">
        <button className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || !loaded || saved.status === "revoking"} type="submit">{saved.configured ? "Replace credentials" : "Save credentials"}</button>
        <button className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || !loaded || !saved.configured || saved.status !== "active"} type="button" onClick={() => void manage("verify")}>Verify credentials</button>
        <button className="rounded border px-3 py-2 disabled:opacity-50" disabled={busy || !loaded || !saved.configured} type="button" onClick={() => void manage("delete")}>Delete credentials</button>
      </div>
    </form>
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
  </section>;
}
