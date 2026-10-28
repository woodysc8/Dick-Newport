import Link from "next/link";
import { redirect } from "next/navigation";
import FinancialProfileForm from "../../components/FinancialProfileForm";
import { STARTER_FINANCIAL_PROFILE, type FinancialProfile } from "../../../lib/financialProfileDefaults";
import { createSupabaseServerClient, ensureOwnProfile } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  await ensureOwnProfile(supabase, auth.user.id);
  const { data } = await supabase.from("profiles").select("financial_profile").eq("id", auth.user.id).maybeSingle();
  const profile = isProfile(data?.financial_profile) ? data.financial_profile : STARTER_FINANCIAL_PROFILE;
  const query = await searchParams;

  return <main className="min-h-screen bg-[var(--bg)] px-4 py-8 text-[var(--text)] sm:px-8"><div className="mx-auto max-w-4xl">
    <Link href="/" className="text-sm text-[var(--text-muted)] hover:underline">← Dashboard</Link>
    <header className="my-7"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-ink)]">Settings</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Financial profile</h1><p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">Update your planning assumptions. Connected account data stays separate from values you enter here.</p></header>
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-7"><FinancialProfileForm profile={profile} mode="settings" saved={query.saved === "1"} /></section>
  </div></main>;
}

function isProfile(value: unknown): value is FinancialProfile {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).currency === "string" && typeof (value as Record<string, unknown>).label === "string");
}
