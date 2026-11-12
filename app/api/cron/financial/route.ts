import { authorizedCron } from "../../../../lib/financialJobs";
import { getScheduledPlaidContext } from "../../../../lib/plaidTenant";
import { runScheduledFinance } from "../../../../lib/scheduledFinancialSync";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function GET(request: Request) {
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  if (!authorizedCron(request))
    return json({ error: "Scheduler authentication required" }, 401);
  if (process.env.SCHEDULED_FINANCE_ENABLED !== "true")
    return json({ enabled: false, skipped: true });
  try {
    const context = await getScheduledPlaidContext(request);
    if (!context)
      return json(
        { error: "Explicit scheduler owner authorization is unavailable" },
        503,
      );
    return json(await runScheduledFinance(context));
  } catch {
    return json(
      { error: "Scheduled finance unavailable", category: "UNAVAILABLE" },
      503,
    );
  }
}
