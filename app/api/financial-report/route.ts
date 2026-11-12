import { getAuthenticatedSupabaseContext } from "../../../lib/supabase/server";
import { isSameOriginRequest, readLimitedJson } from "../../../lib/requestSecurity";
import { generateFinancialReport } from "../../../lib/financialReport";
import { latestReport, readReport, reportHistory, reportStorageEnabled, requireReportStorage, ReportError, saveReport } from "../../../lib/financialReportStore";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
async function handle(request: Request) {
  try {
    if (request.method !== "GET" && !isSameOriginRequest(request)) return json({ error: "Cross-origin requests are not allowed." }, 403);
    const context = await getAuthenticatedSupabaseContext(request);
    if (!context) return json({ error: "Authentication required." }, 401);
    const { supabase: client, user } = context;
    const enabled = reportStorageEnabled();
    if (request.method === "POST") {
      requireReportStorage();
      let body: Record<string, unknown>;
      try { body = await readLimitedJson(request); } catch { return json({ error: "A small JSON request is required." }, 400); }
      if (body.action === "preferences") {
        if (typeof body.weekly !== "boolean" || typeof body.monthly !== "boolean") return json({ error: "Select weekly and monthly preferences." }, 400);
        const result = await client.from("financial_report_preferences").upsert({ user_id: user.id, weekly: body.weekly, monthly: body.monthly, updated_at: new Date().toISOString() });
        if (result.error) throw new ReportError(503, "Schedule preferences could not be saved.");
        return json({ saved: true });
      }
      if (body.action !== "update") return json({ error: "Invalid report action." }, 400);
      const result = await saveReport(client, user.id);
      return json({ ...result, storageEnabled: enabled, scheduleEnabled: process.env.FINANCIAL_REPORT_SCHEDULE_ENABLED === "true", history: await reportHistory(client, user.id) });
    }
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    if (id && !enabled) throw new ReportError(503, "Report history is disabled pending activation approval.");
    const saved = enabled ? id ? await readReport(client, user.id, id) : await latestReport(client, user.id) : null;
    const report = !saved || params.get("preview") === "true" ? await generateFinancialReport(client, user.id, saved?.report ?? null) : saved.report;
    let preferences = { weekly: false, monthly: false };
    if (enabled) {
      const result = await client.from("financial_report_preferences").select("weekly, monthly").eq("user_id", user.id).maybeSingle();
      if (result.error) throw new ReportError(503, "Report schedule preferences unavailable.");
      preferences = result.data ?? preferences;
    }
    return json({ report, id: params.get("preview") === "true" ? null : saved?.id ?? null, history: enabled ? await reportHistory(client, user.id) : [], preferences, storageEnabled: enabled, scheduleEnabled: process.env.FINANCIAL_REPORT_SCHEDULE_ENABLED === "true" });
  } catch (error) {
    return error instanceof ReportError ? json({ error: error.message }, error.status) : json({ error: "Financial report unavailable. Please retry; no existing report was changed." }, 503);
  }
}
export const GET = handle;
export const POST = handle;
