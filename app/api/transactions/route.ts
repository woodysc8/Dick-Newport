import { isBudgetCategory } from "../../../lib/discretionaryBudget";
import {
  listAccounts,
  listTransactions,
  listTransactionSuggestions,
  TransactionInputError,
  uuid,
} from "../../../lib/transactionData";
import { transactionRoute } from "../../../lib/transactionRoute";
import { loadBudgetPolicy } from "../../../lib/financialBudgetData";

export function GET(request: Request) {
  return transactionRoute(request, async ({ supabase, user }) => {
    const params = new URL(request.url).searchParams;
    if (params.get("view") === "suggestions") {
      const [accounts, policy] = await Promise.all([
        listAccounts(supabase, user.id), loadBudgetPolicy(supabase, user.id),
      ]);
      return listTransactionSuggestions(supabase, user.id, params, accounts, policy);
    }
    return {
    ...(await listTransactions(
      supabase,
      user.id,
      new URL(request.url).searchParams,
    )),
    accounts: await listAccounts(supabase, user.id),
    policy: await loadBudgetPolicy(supabase, user.id),
    };
  });
}
export function PATCH(request: Request) {
  return transactionRoute(request, async ({ supabase, user }, body) => {
    if (
      Object.keys(body).some(
        (k) =>
          ![
            "id",
            "category_override",
            "weekly_budget_override",
            "monthly_budget_override",
          ].includes(k),
      ) ||
      !uuid(body.id) ||
      !(
        "category_override" in body ||
        "weekly_budget_override" in body ||
        "monthly_budget_override" in body
      ) ||
      ("monthly_budget_override" in body &&
        body.monthly_budget_override !== null &&
        (typeof body.monthly_budget_override !== "string" ||
          !["include", "exclude"].includes(body.monthly_budget_override))) ||
      ("category_override" in body &&
        body.category_override !== null &&
        !isBudgetCategory(body.category_override)) ||
      ("weekly_budget_override" in body &&
        body.weekly_budget_override !== null &&
        (typeof body.weekly_budget_override !== "string" ||
          !["include", "exclude"].includes(body.weekly_budget_override)))
    )
      throw new TransactionInputError("Invalid transaction correction");
    const changes = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== "id"),
    );
    const { data, error } = await supabase
      .from("transactions")
      .update(changes)
      .eq("user_id", user.id)
      .eq("id", body.id)
      .select("id")
      .maybeSingle();
    if (error) throw new Error();
    if (!data)
      throw new TransactionInputError(
        "Transaction not found for this user. Refresh the list; it may have posted or been removed.",
      );
    return { saved: true };
  });
}
