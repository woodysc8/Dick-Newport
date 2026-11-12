import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BriefingError } from "./googleBriefing";
import { weekPeriod } from "./discretionaryBudget";
export class FinancialJobError extends Error {
  constructor(public status = 429) {
    super(
      status === 429
        ? "A financial job is already running, cooling down, completed, or at its daily attempt limit. Check status before retrying."
        : "Financial job tracking is unavailable. Check the approved migration and retry later.",
    );
  }
}

export function financialServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new BriefingError("CONFIGURATION");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function withFinancialJob<T>(
  client: SupabaseClient,
  owner: string,
  kind: "sync" | "briefing",
  key: string,
  work: () => Promise<T>,
) {
  const token = randomUUID();
  const args = { owner_id: owner, job_kind: kind, key, lease_token: token };
  const claim = await client.rpc("claim_financial_job", args);
  if (claim.error) throw new FinancialJobError(503);
  if (claim.data !== true) throw new FinancialJobError();
  try {
    const result = await work();
    const finish = await client.rpc("finish_financial_job", {
      ...args,
      succeeded: true,
      error_category: null,
    });
    if (finish.error || finish.data !== true) throw new FinancialJobError(503);
    return result;
  } catch (error) {
    const category =
      error instanceof BriefingError ? error.category : "UNAVAILABLE";
    try {
      await client.rpc("finish_financial_job", {
        ...args,
        succeeded: false,
        error_category: category,
      });
    } catch {
      /* lease expires; never log provider errors */
    }
    throw error instanceof BriefingError || error instanceof FinancialJobError
      ? error
      : new FinancialJobError(503);
  }
}
export function authorizedCron(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32) return false;
  const supplied = request.headers.get("authorization") ?? "";
  return timingSafeEqual(
    createHash("sha256").update(supplied).digest(),
    createHash("sha256").update(`Bearer ${secret}`).digest(),
  );
}
export function scheduledSlots(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value),
    minute = Number(parts.find((p) => p.type === "minute")?.value),
    date = weekPeriod(now).today;
  const syncHours = (process.env.FINANCIAL_SYNC_LOCAL_HOURS ?? "0,6,12,18")
    .split(",")
    .map(Number);
  if (
    syncHours.length !== 4 ||
    new Set(syncHours).size !== 4 ||
    syncHours.some((h) => !Number.isInteger(h) || h < 0 || h > 23)
  )
    throw new BriefingError("CONFIGURATION");
  return {
    date,
    sync:
      syncHours.includes(hour) && minute < 30 ? `${date}:sync:${hour}` : null,
    briefing: hour === 6 && minute >= 30 ? `${date}:briefing` : null,
  };
}
