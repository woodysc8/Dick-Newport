import { redirect } from "next/navigation";
import { getAuthenticatedSupabaseContext } from "../../lib/supabase/server";
import { Shell } from "../components/FinancePage";
import TransactionsWorkspace from "../components/TransactionsWorkspace";
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
      ["q", "account", "category", "status", "start", "end", "page"].includes(
        key,
      )
    )
      params.set(key, value);
  return (
    <Shell
      active="Transactions"
      title="Transactions"
      description="Review imported activity, correct categories, and understand weekly spending."
    >
      <TransactionsWorkspace
        key={params.toString()}
        initialQuery={params.toString()}
      />
    </Shell>
  );
}
