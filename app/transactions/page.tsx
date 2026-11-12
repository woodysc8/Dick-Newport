import { redirect } from "next/navigation";
import { getAuthenticatedSupabaseContext } from "../../lib/supabase/server";
import { Shell } from "../components/FinancePage";
import MonthlyTransactions from "../components/MonthlyTransactions";
export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!(await getAuthenticatedSupabaseContext())) redirect("/login");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams))
    if (
      typeof value === "string" &&
      ["month", "account", "page"].includes(
        key,
      )
    )
      params.set(key, value);
  return (
    <Shell
      active="Transactions"
      title="Transactions"
      description="Monthly spending and your transaction history, newest first."
    >
      <MonthlyTransactions
        key={params.toString()}
        initialQuery={params.toString()}
      />
    </Shell>
  );
}
