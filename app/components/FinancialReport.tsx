"use client";
import { useEffect, useState } from "react";
import type { FinancialReport as Report } from "../../lib/financialReport";

type View = { report: Report; id: string | null; history: { id: string; generated_at: string }[]; storageEnabled: boolean; scheduleEnabled: boolean; preferences?: { weekly: boolean; monthly: boolean } };
async function fetchReport(query = "", body?: Record<string, unknown>, signal?: AbortSignal): Promise<View> {
  const response = await fetch(`/api/financial-report${query}`, { cache: "no-store", signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Report unavailable.");
  return result;
}
export default function FinancialReport() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [preferences, setPreferences] = useState({ weekly: false, monthly: false });
  async function load(query = "", body?: Record<string, unknown>, signal?: AbortSignal) {
    try {
      const result = await fetchReport(query, body, signal);
      if (signal?.aborted) return;
      setView(result);
      if (result.preferences) setPreferences(result.preferences);
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : "Report unavailable."); }
    finally { if (!signal?.aborted) setBusy(false); }
  }
  function reload(query = "", body?: Record<string, unknown>) {
    setBusy(true); setError(""); setNotice(""); void load(query, body);
  }
  useEffect(() => {
    const controller = new AbortController(), signal = controller.signal;
    void fetchReport("", undefined, signal).then((result) => {
      if (!signal.aborted) { setView(result); if (result.preferences) setPreferences(result.preferences); }
    }).catch((failure) => { if (!signal.aborted) setError(failure instanceof Error ? failure.message : "Report unavailable."); })
      .finally(() => { if (!signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, []);
  async function download(format: "docx" | "pdf") {
    if (!view) return;
    setBusy(true); setError("");
    try {
      const { exportReportDocx, exportReportPdf } = await import("../../lib/financialReportExport");
      const bytes = await (format === "docx" ? exportReportDocx : exportReportPdf)(view.report, !!view.id);
      const blob = new Blob([new Uint8Array(bytes)], { type: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `financial-report-${view.report.generatedAt.slice(0, 10)}.${format}`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError("Download could not be generated. Your report is unchanged."); }
    finally { setBusy(false); }
  }
  async function savePreferences() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/financial-report", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "preferences", ...preferences }) });
      if (!response.ok) throw new Error();
      setNotice("Preferences saved. Updates run only when the report scheduler is activated.");
    } catch { setError("Schedule preferences could not be saved."); }
    finally { setBusy(false); }
  }
  const button = "rounded border border-[var(--border)] px-4 py-2 text-sm disabled:opacity-50";
  return <div className="space-y-5">
    <section className="finance-panel rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <button className={button} disabled={busy} onClick={() => reload(view?.storageEnabled ? "" : "?preview=true", view?.storageEnabled ? { action: "update" } : undefined)}>Update report</button>
        <button className={button} disabled={busy || !view} onClick={() => void download("docx")}>Download Word</button>
        <button className={button} disabled={busy || !view} onClick={() => void download("pdf")}>Download PDF</button>
      </div>
      <p className="mt-3 text-sm text-[var(--text-muted)]">{busy ? "Preparing report…" : view?.id ? "Saved historical snapshot. Update report creates a new snapshot." : "Unsaved preview. Update report reads the latest saved financial records."} This does not refresh bank connections.</p>
      {view && !view.storageEnabled && <p className="mt-2 text-sm">Private report history and schedules await migration and activation approval. Preview and downloads are available.</p>}
      {view?.storageEnabled && <label className="mt-4 block text-sm">Saved reports (latest 50)<select className="ml-3 rounded border p-2" disabled={busy} value={view.id ?? ""} onChange={(e) => reload(e.target.value ? `?id=${encodeURIComponent(e.target.value)}` : "?preview=true")}><option value="">Latest records preview</option>{view.history.map((h) => <option key={h.id} value={h.id}>{new Date(h.generated_at).toLocaleString()}</option>)}</select></label>}
      {error && <p role="alert" className="mt-3">{error}</p>}{notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    </section>
    {view && <article aria-label="Personal Financial Report" className="finance-panel rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-5 sm:p-8">
      <header className="mb-7 border-b border-[var(--border)] pb-5"><p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">Private and confidential</p><h2 className="mt-2 text-2xl font-semibold">Personal Financial Report</h2><p className="mt-2 text-sm">Generated {new Date(view.report.generatedAt).toLocaleString()} · {view.id ? "Saved snapshot" : "Unsaved preview"}</p></header>
      {view.report.sections.map((s) => <section key={s.title} className="mb-7"><h3 className="mb-3 text-lg font-semibold">{s.title}</h3><div className="space-y-2">{s.lines.map((line, i) => <p key={i} className="break-words text-sm leading-6 text-[var(--text-muted)]">{line}</p>)}</div></section>)}
    </article>}
    {view && <details className="rounded-2xl border border-[var(--border)] p-5"><summary className="cursor-pointer font-medium">Optional report updates</summary><p className="mt-3 text-sm">Monday reports use the current month. First-of-month snapshots show the previous calendar month’s spending and balances recorded at generation. Timezone: America/New_York. Scheduler {view.scheduleEnabled ? "enabled" : "inactive"}; no bank refresh is performed.</p><div className="my-4 flex flex-wrap gap-5"><label><input type="checkbox" disabled={!view.storageEnabled || busy} checked={preferences.weekly} onChange={(e) => setPreferences({ ...preferences, weekly: e.target.checked })} /> Monday weekly report</label><label><input type="checkbox" disabled={!view.storageEnabled || busy} checked={preferences.monthly} onChange={(e) => setPreferences({ ...preferences, monthly: e.target.checked })} /> First-day monthly snapshot</label></div><button className={button} disabled={!view.storageEnabled || busy} onClick={() => void savePreferences()}>Save update preferences</button></details>}
  </div>;
}
