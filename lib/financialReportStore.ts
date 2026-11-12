import type { SupabaseClient } from "@supabase/supabase-js";
import { generateFinancialReport, type FinancialReport } from "./financialReport";
import { uuid } from "./transactionData";

export const reportStorageEnabled = () => process.env.FINANCIAL_REPORT_STORAGE_ENABLED === "true";
export class ReportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function requireReportStorage() {
  if (!reportStorageEnabled()) throw new ReportError(503, "Report saving is disabled pending migration and activation approval. Preview and downloads remain available.");
}
export function storedReport(value: unknown): FinancialReport {
  if (!value || typeof value !== "object") throw new ReportError(503, "Saved report is unavailable.");
  const r = value as FinancialReport;
  if (r.version !== 1 || typeof r.generatedAt !== "string" || !Number.isFinite(Date.parse(r.generatedAt)) || !Array.isArray(r.sections) || r.sections.length > 20 || r.sections.some((s) => typeof s.title !== "string" || !Array.isArray(s.lines) || s.lines.length > 1000 || s.lines.some((line) => typeof line !== "string" || line.length > 4000)))
    throw new ReportError(503, "Saved report format is unavailable.");
  return r;
}
export async function latestReport(client: SupabaseClient, owner: string) {
  const result = await client.from("financial_report_snapshots").select("id, report").eq("user_id", owner).order("generated_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  if (result.error) throw new ReportError(503, "Report history unavailable. Verify the approved report migration before enabling saving.");
  return result.data?.[0] ? { id: result.data[0].id as string, report: storedReport(result.data[0].report) } : null;
}
export async function reportHistory(client: SupabaseClient, owner: string) {
  const result = await client.from("financial_report_snapshots").select("id, generated_at").eq("user_id", owner).order("generated_at", { ascending: false }).order("id", { ascending: false }).limit(50);
  if (result.error) throw new ReportError(503, "Report history unavailable.");
  return result.data ?? [];
}
export async function readReport(client: SupabaseClient, owner: string, id: string) {
  if (!uuid(id)) throw new ReportError(400, "Invalid report selection.");
  const result = await client.from("financial_report_snapshots").select("id, report").eq("user_id", owner).eq("id", id).maybeSingle();
  if (result.error) throw new ReportError(503, "Saved report unavailable.");
  if (!result.data) throw new ReportError(404, "Report not found.");
  return { id: result.data.id as string, report: storedReport(result.data.report) };
}
export async function saveReport(client: SupabaseClient, owner: string, scheduleKey: string | null = null, now = new Date(), month?: string) {
  requireReportStorage();
  if (scheduleKey) {
    const existing = await client.from("financial_report_snapshots").select("id").eq("user_id", owner).eq("schedule_key", scheduleKey).maybeSingle();
    if (existing.error) throw new ReportError(503, "Scheduled report status unavailable.");
    if (existing.data) return { id: existing.data.id as string, skipped: true };
  }
  const previous = await latestReport(client, owner);
  const report = await generateFinancialReport(client, owner, previous?.report ?? null, now, month);
  const result = await client.from("financial_report_snapshots").insert({ user_id: owner, generated_at: report.generatedAt, schema_version: 1, report, schedule_key: scheduleKey }).select("id").single();
  // A concurrent scheduled run may win the unique constraint. Never upsert:
  // that would overwrite an existing historical report.
  if (scheduleKey && result.error?.code === "23505") return { id: null, skipped: true };
  if (result.error || !result.data) throw new ReportError(503, "Report could not be saved. Existing history is unchanged.");
  return { id: result.data.id as string, report, skipped: false };
}
