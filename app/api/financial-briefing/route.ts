import { transactionRoute } from "../../../lib/transactionRoute";
import { TransactionInputError } from "../../../lib/transactionData";
import { loadFinancialBudget } from "../../../lib/financialBudgetData";
import { generateBriefing } from "../../../lib/financialBriefing";
import {
  BriefingError,
  googleBriefingConfig,
  publishGoogleBriefing,
} from "../../../lib/googleBriefing";
import {
  FinancialJobError,
  financialServiceClient,
  withFinancialJob,
} from "../../../lib/financialJobs";

export const runtime = "nodejs";
export const maxDuration = 120;
export function GET(request: Request) {
  return transactionRoute(request, async ({ supabase, user }) => {
    let configured = false;
    try {
      googleBriefingConfig(user.id);
      configured = true;
    } catch {
      /* disabled is safe */
    }
    const { data, error } = await supabase
      .from("financial_job_status")
      .select("kind,last_attempt_at,last_success_at,last_error")
      .eq("user_id", user.id);
    return {
      configured,
      status: error ? [] : data,
      statusAvailable: !error,
      schedulingEnabled:
        process.env.SCHEDULED_FINANCE_ENABLED === "true" &&
        process.env.SCHEDULED_FINANCE_OWNER_USER_ID === user.id,
      nextScheduledRun:
        "Disabled until an authorized scheduler is configured; target 06:30–07:00 America/New_York, without punctuality guarantee.",
      setup: "/docs/google-docs-financial-briefing.md",
    };
  });
}
export function POST(request: Request) {
  return transactionRoute(request, async ({ supabase, user }, body) => {
    if (
      Object.keys(body).some(
        (k) => !["action", "confirmed", "hash", "generatedAt"].includes(k),
      ) ||
      !["preview", "publish"].includes(String(body.action))
    )
      throw new TransactionInputError(
        "Choose preview or explicitly confirmed publish",
      );
    const now =
      body.action === "publish"
        ? new Date(String(body.generatedAt))
        : new Date();
    if (
      !Number.isFinite(now.getTime()) ||
      Math.abs(Date.now() - now.getTime()) > 15 * 60000
    )
      throw new TransactionInputError(
        "Preview expired. Preview again before publishing.",
      );
    try {
      const preview = generateBriefing(
        await loadFinancialBudget(supabase, user.id, now),
        now,
      );
      if (body.action === "preview") return { preview };
      if (
        body.confirmed !== true ||
        typeof body.hash !== "string" ||
        body.hash !== preview.hash
      )
        throw new BriefingError("STALE_PREVIEW");
      googleBriefingConfig(user.id);
      return await withFinancialJob(
        financialServiceClient(),
        user.id,
        "briefing",
        `manual:${preview.hash}`,
        () => publishGoogleBriefing(user.id, preview.text),
      );
    } catch (error) {
      if (error instanceof BriefingError || error instanceof FinancialJobError)
        throw new TransactionInputError(error.message);
      throw error;
    }
  });
}
