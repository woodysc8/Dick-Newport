import { authorizedCron, financialServiceClient } from "../../../../lib/financialJobs";
import { runReportSchedule } from "../../../../lib/financialReportSchedule";

export async function GET(request: Request) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!authorizedCron(request)) return json({ error: "Unauthorized" }, 401);
  if (process.env.FINANCIAL_REPORT_SCHEDULE_ENABLED !== "true" || process.env.FINANCIAL_REPORT_STORAGE_ENABLED !== "true") return json({ enabled: false });
  try {
    const result = await runReportSchedule(financialServiceClient());
    return json(result, result.failed ? 503 : 200);
  } catch { return json({ error: "Report schedule unavailable." }, 503); }
}
