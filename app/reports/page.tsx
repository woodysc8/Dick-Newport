import { redirect } from "next/navigation";
import { getAuthenticatedSupabaseContext } from "../../lib/supabase/server";
import { Shell } from "../components/FinancePage";
import FinancialReport from "../components/FinancialReport";
export default async function ReportsPage() {
  if (!await getAuthenticatedSupabaseContext()) redirect("/login");
  return <Shell active="Financial Report" title="Financial Report" description="A private report of your recorded financial position, monthly activity and data quality."><FinancialReport /></Shell>;
}
