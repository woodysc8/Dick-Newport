import { NextResponse } from "next/server";
import classifyTransaction from "../../../../lib/classifyTransaction";
import { getAuthenticatedSupabaseContext } from "../../../../lib/supabase/server";

export async function GET(request: Request) {
  const auth = await getAuthenticatedSupabaseContext(request);
  if (!auth) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const { data: txs, error } = await auth.supabase
      .from("transactions")
      .select("id, date, name, merchant_name, amount, category, pending, plaid_transaction_id")
      .eq("user_id", auth.user.id)
      .order("date", { ascending: false })
      .limit(1000);

    if (error) {
      console.error("Supabase transactions fetch error:", error);
      return NextResponse.json({ error: "Failed fetching transactions" }, { status: 500 });
    }

    const totals: any = {
      income: 0,
      spending: 0,
      transfers: 0,
      credit_card_payments: 0,
      investments: 0,
      arbitrage: 0,
      gambling: 0,
      by_budget_category: {},
    };

    const examples: any[] = [];

    for (const tx of txs ?? []) {
      const cls = (classifyTransaction as any)(tx);

      // sum amounts conservatively: only include when include flags true
      const amt = Number(tx.amount) || 0;
      if (cls.include_in_income) totals.income += amt;
      if (cls.include_in_spending) totals.spending += amt;
      if (cls.financial_type === "transfer") totals.transfers += amt;
      if (cls.financial_type === "credit_card_payment") totals.credit_card_payments += amt;
      if (cls.financial_type === "investment") totals.investments += amt;
      if (cls.financial_type === "arbitrage") totals.arbitrage += amt;
      if (cls.financial_type === "gambling") totals.gambling += amt;

      if (cls.budget_category) {
        totals.by_budget_category[cls.budget_category] = (totals.by_budget_category[cls.budget_category] || 0) + amt;
      }

      if (examples.length < 20) {
        examples.push({
          id: tx.id,
          date: tx.date,
          name: tx.name,
          merchant_name: tx.merchant_name,
          amount: tx.amount,
          old_category: tx.category,
          classification: cls,
        });
      }
    }

    return NextResponse.json({ success: true, totals, examples });
  } catch (err: any) {
    console.error("Classification diagnostic error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
