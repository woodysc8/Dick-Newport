import { NextResponse } from "next/server";
import accounting from "../../../../lib/accounting";
import classifyTransaction from "../../../../lib/classifyTransaction";
import { getAuthenticatedSupabaseContext } from "../../../../lib/supabase/server";

export async function GET(request: Request) {
  const auth = await getAuthenticatedSupabaseContext(request);
  if (!auth) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    // month range same as dashboard
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthStart = new Date(year, month, 1).toISOString().slice(0, 10);
    const monthEnd = new Date(year, month + 1, 0).toISOString().slice(0, 10);

    // fetch accounts
    const { data: accounts, error: accErr } = await auth.supabase
      .from("accounts")
      .select("id, institution_name, account_name, account_type, account_subtype, current_balance, available_balance, plaid_account_id, mask")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });

    if (accErr) {
      console.error("accounts fetch error", accErr);
      return NextResponse.json({ error: "Failed fetching accounts" }, { status: 500 });
    }

    // fetch transactions for the month
    const { data: transactions, error: txErr } = await auth.supabase
      .from("transactions")
      .select("id, date, name, merchant_name, amount, category, pending, plaid_transaction_id, account_id")
      .eq("user_id", auth.user.id)
      .gte("date", monthStart)
      .lte("date", monthEnd)
      .order("date", { ascending: false });

    if (txErr) {
      console.error("transactions fetch error", txErr);
      return NextResponse.json({ error: "Failed fetching transactions" }, { status: 500 });
    }

    const accountsList = accounts ?? [];
    const txList = transactions ?? [];

    // ACCOUNT SUMMARY via accounting.summarizeAccounts
    const acctSummary = accounting.summarizeAccounts(accountsList as any);

    // MONTHLY ACCOUNTING via accounting.computeMonthlyAccounting
    const monthly = accounting.computeMonthlyAccounting(txList as any, accountsList as any);

    // Use accounting's transactionBuckets for consistent final bucket decisions
    const acctById = new Map<string, any>();
    for (const a of accountsList) {
      if (a.id) acctById.set(String(a.id), a);
    }

    const incomeTxs: any[] = [];
    const spendingTxs: any[] = [];
    const excludedTxs: any[] = [];

    const buckets: Record<string, string> = (monthly as any).transactionBuckets ?? {};

    for (const tx of txList) {
      const key = String(tx.plaid_transaction_id ?? tx.id ?? "");
      const bucket = buckets[key] || "other_non_spending";
      const acct = acctById.get(String(tx.account_id)) ?? null;
      const cls = (classifyTransaction as any)(tx, acct);

      // Derive final classification booleans from the final bucket to ensure consistency
      const finalCls = { ...cls } as any;
      switch (bucket) {
        case "pending":
          finalCls.financial_type = "unknown";
          finalCls.is_income = false;
          finalCls.is_spending = false;
          finalCls.is_transfer = false;
          finalCls.is_credit_card_payment = false;
          finalCls.is_refund = false;
          finalCls.include_in_income = false;
          finalCls.include_in_spending = false;
          break;
        case "transfer":
          finalCls.financial_type = "transfer";
          finalCls.is_income = false;
          finalCls.is_spending = false;
          finalCls.is_transfer = true;
          finalCls.is_credit_card_payment = false;
          finalCls.is_refund = false;
          finalCls.include_in_income = false;
          finalCls.include_in_spending = false;
          break;
        case "credit_card_payment":
          finalCls.financial_type = "credit_card_payment";
          finalCls.is_income = false;
          finalCls.is_spending = false;
          finalCls.is_transfer = false;
          finalCls.is_credit_card_payment = true;
          finalCls.is_refund = false;
          finalCls.include_in_income = false;
          finalCls.include_in_spending = false;
          break;
        case "refund":
          finalCls.financial_type = "refund";
          finalCls.is_income = false;
          finalCls.is_spending = false;
          finalCls.is_transfer = false;
          finalCls.is_credit_card_payment = false;
          finalCls.is_refund = true;
          finalCls.include_in_income = false;
          finalCls.include_in_spending = false;
          break;
        case "income":
          finalCls.financial_type = "income";
          finalCls.is_income = true;
          finalCls.is_spending = false;
          finalCls.is_transfer = false;
          finalCls.is_credit_card_payment = false;
          finalCls.is_refund = false;
          finalCls.include_in_income = true;
          finalCls.include_in_spending = false;
          break;
        case "spending":
          finalCls.financial_type = "spending";
          finalCls.is_income = false;
          finalCls.is_spending = true;
          finalCls.is_transfer = false;
          finalCls.is_credit_card_payment = false;
          finalCls.is_refund = false;
          finalCls.include_in_income = false;
          finalCls.include_in_spending = true;
          break;
        case "investment":
          finalCls.financial_type = "investment";
          finalCls.is_income = false;
          finalCls.is_spending = false;
          finalCls.is_transfer = false;
          finalCls.is_credit_card_payment = false;
          finalCls.is_refund = false;
          finalCls.include_in_income = false;
          finalCls.include_in_spending = false;
          break;
        default:
          // other_non_spending or unknown
          finalCls.financial_type = finalCls.financial_type ?? "unknown";
          finalCls.is_income = false;
          finalCls.is_spending = false;
          finalCls.is_transfer = false;
          finalCls.is_credit_card_payment = false;
          finalCls.is_refund = false;
          finalCls.include_in_income = false;
          finalCls.include_in_spending = false;
      }

      const record = { ...tx, classification: finalCls };

      if (bucket === "income") incomeTxs.push(record);
      else if (bucket === "spending") spendingTxs.push(record);
      else excludedTxs.push({ ...record, excluded_reason: bucket });
    }

    // CATEGORY TOTALS from monthly.spendingByCategory
    const categoryTotals = monthly.spendingByCategory;

    // SANITY CHECKS
    const numFinalIncome = incomeTxs.length;
    const numFinalSpending = spendingTxs.length;
    const numPending = txList.filter((t) => t.pending).length;
    const numTransfers = excludedTxs.filter((t) => t.excluded_reason === "transfer").length;
    const numCCPayments = excludedTxs.filter((t) => t.excluded_reason === "credit_card_payment").length;
    const numRefunds = excludedTxs.filter((t) => t.excluded_reason === "refund").length;

    const computedNet = (monthly.income || 0) - (monthly.spending || 0);

    return NextResponse.json({
      account_summary: {
        accounts: accountsList,
        totals: {
          cash: acctSummary.cash,
          investments: acctSummary.investments,
          crypto: acctSummary.crypto,
          credit: acctSummary.credit,
          net_worth: acctSummary.netWorth,
        },
      },
      monthly_accounting: {
        income: monthly.income,
        spending: monthly.spending,
        net: computedNet,
        pending_spending: monthly.pendingSpending,
        credit_card_payments: monthly.creditCardPayments,
        refunds: monthly.refunds,
        transfers: monthly.transfers,
      },
      income_transactions: incomeTxs,
      spending_transactions: spendingTxs,
      excluded_transactions: excludedTxs,
      category_totals: categoryTotals,
      sanity: {
        num_finalized_income_transactions: numFinalIncome,
        num_finalized_spending_transactions: numFinalSpending,
        num_pending_transactions: numPending,
        num_transfers: numTransfers,
        num_credit_card_payments: numCCPayments,
        num_refunds: numRefunds,
        computed_net: computedNet,
        reported_net: computedNet,
      },
    });
  } catch (err: any) {
    console.error("accounting audit error", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
