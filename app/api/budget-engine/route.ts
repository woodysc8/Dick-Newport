import { loadFinancialBudget } from "../../../lib/financialBudgetData";
import { transactionRoute } from "../../../lib/transactionRoute";
import { TransactionInputError, uuid } from "../../../lib/transactionData";
import { isBudgetCategory } from "../../../lib/discretionaryBudget";
import { ensureOwnProfile } from "../../../lib/supabase/server";

export function GET(request: Request) {
  return transactionRoute(request, async ({ supabase, user }) => {
    const data = await loadFinancialBudget(supabase, user.id);
    return {
      weekly: data.weekly,
      monthly: data.monthly,
      caps: data.caps,
      policy: data.policy,
      accounts: data.snapshot.accounts,
      jobs: data.snapshot.jobs,
    };
  });
}
export function PUT(request: Request) {
  return transactionRoute(request, async ({ supabase, user }, body) => {
    const allowed =
      body.kind === "category"
        ? [
            "kind",
            "category",
            "weekly_included",
            "monthly_included",
            "monthly_group",
            "weekly_cap",
            "monthly_cap",
          ]
        : body.kind === "account"
          ? ["kind", "account_id", "weekly_included", "monthly_included"]
          : body.kind === "monthly"
            ? ["kind", "monthly_limit"]
            : [];
    if (
      !allowed.length ||
      Object.keys(body).some((key) => !allowed.includes(key))
    )
      throw new TransactionInputError("Invalid budget settings");
    for (const key of ["weekly_included", "monthly_included"])
      if (key in body && body[key] !== null && typeof body[key] !== "boolean")
        throw new TransactionInputError(
          "Inclusion must be default, included or excluded",
        );
    for (const key of ["weekly_cap", "monthly_cap", "monthly_limit"])
      if (
        key in body &&
        body[key] !== null &&
        (typeof body[key] !== "number" ||
          !Number.isFinite(body[key]) ||
          (body[key] as number) < 0 ||
          (body[key] as number) > 100000000 ||
          Math.abs(
            (body[key] as number) * 100 -
              Math.round((body[key] as number) * 100),
          ) > 0.00001)
      )
        throw new TransactionInputError(
          "Use a nonnegative USD amount with at most two decimals",
        );
    if (
      body.kind === "category" &&
      (!isBudgetCategory(body.category) ||
        (body.monthly_group != null &&
          (typeof body.monthly_group !== "string" ||
            !["fixed", "essential", "discretionary", "excluded"].includes(
              body.monthly_group,
            ))))
    )
      throw new TransactionInputError("Invalid category rule");
    if (body.kind === "account" && !uuid(body.account_id))
      throw new TransactionInputError("Invalid account rule");
    if (body.kind === "monthly" && !("monthly_limit" in body))
      throw new TransactionInputError(
        "Monthly limit is required; null means unset",
      );
    await ensureOwnProfile(supabase, user.id);
    const values = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== "kind"),
    );
    const table =
      body.kind === "category"
        ? "budget_category_rules"
        : body.kind === "account"
          ? "budget_account_rules"
          : "user_monthly_budgets";
    const conflict =
      body.kind === "category"
        ? "user_id,category"
        : body.kind === "account"
          ? "user_id,account_id"
          : "user_id";
    const { error } = await supabase
      .from(table)
      .upsert({ ...values, user_id: user.id }, { onConflict: conflict });
    if (error) throw new Error("Budget preferences unavailable");
    return { saved: true };
  });
}
