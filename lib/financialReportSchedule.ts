import type { SupabaseClient } from "@supabase/supabase-js";
import { weekPeriod } from "./discretionaryBudget";
import { requireReportStorage, ReportError, saveReport } from "./financialReportStore";

export function reportScheduleSlots(now = new Date()) {
  const date = weekPeriod(now).today;
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long" }).format(now);
  const [year, month] = date.split("-").map(Number);
  const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  return {
    weekly: weekday === "Monday" ? `weekly:${date}` : null,
    monthly: date.endsWith("-01") ? `monthly:${date.slice(0, 7)}` : null,
    previousMonth,
  };
}
export async function runReportSchedule(client: SupabaseClient, now = new Date()) {
  requireReportStorage();
  const slots = reportScheduleSlots(now);
  if (!slots.weekly && !slots.monthly) return { saved: 0, skipped: 0, failed: 0 };
  const owners = await client.from("financial_report_preferences").select("user_id, weekly, monthly", { count: "exact" }).or("weekly.eq.true,monthly.eq.true").order("user_id").limit(501);
  if (owners.error || owners.count == null || owners.count > 500 || owners.data?.length !== owners.count) throw new ReportError(503, "Report schedule coverage unavailable.");
  const result = { saved: 0, skipped: 0, failed: 0 };
  for (const owner of owners.data) {
    for (const kind of ["weekly", "monthly"] as const) {
      const key = slots[kind];
      if (!owner[kind] || !key) continue;
      try {
        const snapshot = await saveReport(client, owner.user_id, key, now, kind === "monthly" ? slots.previousMonth : undefined);
        result[snapshot.skipped ? "skipped" : "saved"]++;
      } catch { result.failed++; } // No financial values, owners or provider errors in logs.
    }
  }
  return result;
}
