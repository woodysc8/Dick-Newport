import {
  loadWeeklyBudget,
  TransactionInputError,
  uuid,
} from "../../../lib/transactionData";
import { transactionRoute } from "../../../lib/transactionRoute";
import { ensureOwnProfile } from "../../../lib/supabase/server";

export function GET(request: Request) {
  return transactionRoute(request, ({ supabase, user }) =>
    loadWeeklyBudget(supabase, user.id),
  );
}
export function PUT(request: Request) {
  return transactionRoute(request, async ({ supabase, user }, body) => {
    if (
      Object.keys(body).some((k) => k !== "weekly_limit") ||
      !("weekly_limit" in body) ||
      (body.weekly_limit !== null &&
        (typeof body.weekly_limit !== "number" ||
          !Number.isFinite(body.weekly_limit) ||
          body.weekly_limit < 0 ||
          body.weekly_limit > 100000000 ||
          Math.abs(
            body.weekly_limit * 100 - Math.round(body.weekly_limit * 100),
          ) > 0.00001))
    )
      throw new TransactionInputError(
        "Enter a nonnegative USD limit with at most two decimal places, or clear it.",
      );
    await ensureOwnProfile(supabase, user.id);
    const { error } = await supabase.from("user_weekly_budgets").upsert(
      {
        user_id: user.id,
        weekly_limit: body.weekly_limit,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error();
    return { saved: true };
  });
}
export function PATCH(request: Request) {
  return transactionRoute(request, async ({ supabase, user }, body) => {
    if (
      Object.keys(body).some((k) => !["account_id", "source"].includes(k)) ||
      !uuid(body.account_id) ||
      typeof body.source !== "string" ||
      !["review", "include", "exclude"].includes(body.source)
    )
      throw new TransactionInputError("Invalid account source selection");
    const { data, error } = await supabase
      .from("accounts")
      .update({ weekly_budget_source: body.source })
      .eq("user_id", user.id)
      .eq("id", body.account_id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error();
    if (!data)
      throw new TransactionInputError("Account not found for this user");
    return { saved: true };
  });
}
