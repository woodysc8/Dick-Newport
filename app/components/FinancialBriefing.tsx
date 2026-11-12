"use client";
import { useEffect, useRef, useState } from "react";
import { financeRequest, jsonMutation } from "../../lib/financeHttp";
type Status = {
  configured: boolean;
  statusAvailable: boolean;
  status: {
    kind: string;
    last_success_at: string | null;
    last_error: string | null;
  }[];
  nextScheduledRun: string;
};
async function readStatus() {
  const data = await financeRequest<Status>("/api/financial-briefing");
  if (
    typeof data.configured !== "boolean" ||
    !Array.isArray(data.status) ||
    typeof data.nextScheduledRun !== "string"
  )
    throw new Error("Briefing status unavailable. Publishing is disabled.");
  return data;
}
export default function FinancialBriefing() {
  const [status, setStatus] = useState<Status | null>(null),
    [preview, setPreview] = useState<{
      text: string;
      hash: string;
      generatedAt: string;
    } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    void readStatus()
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {
        if (active)
          setError("Briefing status unavailable. Publishing is disabled.");
      });
    return () => {
      active = false;
    };
  }, []);
  async function run(action: "preview" | "publish") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    if (action === "preview") {
      setPreview(null);
      setConfirmed(false);
    }
    try {
      const response = await financeRequest<{
        preview?: typeof preview;
        published?: boolean;
      }>(
        "/api/financial-briefing",
        jsonMutation("POST", {
          action,
          ...(action === "publish"
            ? {
                confirmed,
                hash: preview?.hash,
                generatedAt: preview?.generatedAt,
              }
            : {}),
        }),
      );
      if (action === "preview") {
        if (
          !response.preview ||
          typeof response.preview.text !== "string" ||
          typeof response.preview.hash !== "string" ||
          typeof response.preview.generatedAt !== "string"
        )
          throw new Error(
            "Briefing preview unavailable. Retry before publishing.",
          );
        setPreview(response.preview);
        setConfirmed(false);
      } else {
        if (response.published !== true)
          throw new Error(
            "Publishing was not confirmed. Check status before retrying.",
          );
        setNotice("Private document published successfully.");
        setStatus(await readStatus());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Briefing unavailable");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="my-6 rounded-2xl border border-[var(--border)] p-5"
      aria-label="Private financial briefing"
    >
      <h2 className="text-xl font-semibold">
        Private Google Docs financial briefing
      </h2>
      <p className="mt-3 text-sm">
        Preview reads your saved financial data. Publish updates one authorized
        private Google Doc; your existing Claude Google Docs integration can
        keep reading that same document.
      </p>
      {error && (
        <p role="alert" className="mt-3">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <p className="mt-3 text-sm">
        {status?.configured
          ? "Google authorization configured; privacy is checked again before publishing."
          : "Publishing disabled. An administrator must configure the dedicated private document and explicit Google authorization using docs/google-docs-financial-briefing.md."}
      </p>
      <p className="mt-2 text-sm">
        Last successful publish:{" "}
        {status?.status.find((s) => s.kind === "briefing")?.last_success_at ??
          "Not recorded"}
        . Error:{" "}
        {status?.status.find((s) => s.kind === "briefing")?.last_error ??
          "None recorded"}
        .
      </p>
      <p className="mt-2 text-sm">
        {status?.nextScheduledRun ?? "Scheduling disabled."}
      </p>
      <button
        className="mt-4 rounded border px-4 py-2"
        disabled={busy}
        onClick={() => void run("preview")}
      >
        Preview briefing
      </button>
      {preview && (
        <>
          <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded border p-3 text-sm">
            {preview.text}
          </pre>
          <label className="mt-3 block text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I approve replacing the managed contents of my configured private
            Google Doc with this preview.
          </label>
          <button
            className="mt-3 rounded border px-4 py-2"
            disabled={busy || !confirmed || !status?.configured}
            onClick={() => void run("publish")}
          >
            Publish to private Doc
          </button>
        </>
      )}
    </section>
  );
}
