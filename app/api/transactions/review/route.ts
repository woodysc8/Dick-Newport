import { transactionRoute } from "../../../../lib/transactionRoute";
import { loadFinancialBudget } from "../../../../lib/financialBudgetData";
import { classifyTransaction } from "../../../../lib/transactionClassification";
import { isBudgetCategory } from "../../../../lib/discretionaryBudget";
import { TransactionInputError, uuid } from "../../../../lib/transactionData";

export function GET(request: Request) {
  return transactionRoute(request, async ({ supabase, user }) => {
    const { snapshot } = await loadFinancialBudget(supabase, user.id);
    const before: Record<string, number> = {},
      after: Record<string, number> = {};
    const examples = [];
    for (const t of snapshot.transactions) {
      const old = t.category_override ?? t.normalized_category,
        next = classifyTransaction(t);
      before[old] = (before[old] ?? 0) + 1;
      after[next.category] = (after[next.category] ?? 0) + 1;
      if (
        examples.length < 50 &&
        (old !== next.category || next.category === "needs_review")
      )
        examples.push({
          id: t.id,
          name: t.merchant_name || t.name,
          date: t.date,
          before: old,
          after: next.category,
          source: next.source,
          reason: next.reason,
        });
    }
    return {
      dryRun: true,
      persisted: false,
      start: snapshot.transactions.reduce(
        (d, t) => (t.date < d ? t.date : d),
        "9999-12-31",
      ),
      before,
      after,
      examples,
      scope:
        "Bounded current/previous month and current/previous week; no records changed.",
    };
  });
}
export function POST(request: Request) {
  return transactionRoute(request, async ({ supabase }, body) => {
    if (
      Object.keys(body).some(
        (key) =>
          !["ids", "category", "weekly", "monthly", "confirmed"].includes(key),
      ) ||
      body.confirmed !== true ||
      !Array.isArray(body.ids) ||
      body.ids.length < 1 ||
      body.ids.length > 50 ||
      body.ids.some((id) => !uuid(id)) ||
      new Set(body.ids).size !== body.ids.length ||
      !isBudgetCategory(body.category) ||
      typeof body.weekly !== "string" ||
      !["include", "exclude", "default"].includes(body.weekly) ||
      typeof body.monthly !== "string" ||
      !["include", "exclude", "default"].includes(body.monthly)
    )
      throw new TransactionInputError(
        "Confirm 1–50 distinct transactions and explicit category/inclusion choices",
      );
    const { data, error } = await supabase.rpc("review_budget_transactions", {
      ids: body.ids,
      category: body.category,
      weekly: body.weekly,
      monthly: body.monthly,
    });
    if (error)
      throw new TransactionInputError(
        "Review could not be saved. Refresh and confirm that every transaction still belongs to your account.",
      );
    return { saved: data };
  });
}
