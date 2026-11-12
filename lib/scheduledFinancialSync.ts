import type { PlaidUserContext } from "./plaidTenant";
import { withFinancialJob, scheduledSlots } from "./financialJobs";
import { withPlaidOperation } from "./plaidOperations";
import { getUserPlaidClient } from "./plaidClient";
import {
  createPlaidRefreshContext,
  refreshFinancialData,
} from "./plaidRefresh";
import {
  BriefingError,
  googleBriefingConfig,
  publishGoogleBriefing,
} from "./googleBriefing";
import { loadFinancialBudget } from "./financialBudgetData";
import { generateBriefing } from "./financialBriefing";

export async function runScheduledFinance(
  context: PlaidUserContext,
  now = new Date(),
) {
  const slots = scheduledSlots(now),
    outcomes: Record<string, string> = {};
  if (slots.sync && process.env.SCHEDULED_PLAID_SYNC_ENABLED === "true") {
    try {
      await withFinancialJob(
        context.supabase,
        context.userId,
        "sync",
        slots.sync,
        async () =>
          withPlaidOperation(context, async () => {
            const { client, credentialId } = await getUserPlaidClient(context);
            const result = await refreshFinancialData(
              createPlaidRefreshContext(context, client, credentialId),
            );
            if (!result.success || result.status !== "completed")
              throw new BriefingError("UNAVAILABLE");
            return result;
          }),
      );
      outcomes.sync = "succeeded";
    } catch {
      outcomes.sync = "unavailable_or_already_attempted";
    }
  }
  if (slots.briefing) {
    try {
      googleBriefingConfig(context.userId);
      await withFinancialJob(
        context.supabase,
        context.userId,
        "briefing",
        slots.briefing,
        async () => {
          const preview = generateBriefing(
            await loadFinancialBudget(
              context.supabase,
              context.userId,
              now,
              true,
              true,
            ),
            now,
          );
          return publishGoogleBriefing(context.userId, preview.text);
        },
      );
      outcomes.briefing = "succeeded";
    } catch {
      outcomes.briefing = "unavailable_or_already_attempted";
    }
  }
  return {
    outcomes,
    localDate: slots.date,
    skipped: Object.keys(outcomes).length === 0,
  };
}
