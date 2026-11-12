import Link from "next/link";
import { redirect } from "next/navigation";
import FinancialProfileForm from "../../components/FinancialProfileForm";
import PersonalPlaidCredentials from "../../components/PersonalPlaidCredentials";
import FinancialBriefing from "../../components/FinancialBriefing";
import { STARTER_FINANCIAL_PROFILE, type FinancialProfile } from "../../../lib/financialProfileDefaults";
import { normalizeFinancialProfile } from "../../../lib/financialProfileNormalization";
import { createSupabaseServerClient, ensureOwnProfile } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ProfileSettingsPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  await ensureOwnProfile(supabase, auth.user.id);
  const { data, error } = await supabase.from("profiles").select("financial_profile").eq("id", auth.user.id).maybeSingle();
  if (error) {
    return <ProfileLoadError />;
  }
  const profile = normalizeFinancialProfile(isProfile(data?.financial_profile) ? data.financial_profile : STARTER_FINANCIAL_PROFILE);
  const query = await searchParams;

  return <main className="min-h-screen bg-[var(--bg)] px-4 py-7 text-[var(--text)] sm:px-8 sm:py-10"><div className="mx-auto max-w-4xl">
    <Link href="/" className="text-sm text-[var(--text-muted)] hover:underline">← Dashboard</Link>
    <header className="my-7"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Settings</p><h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em]">Financial profile</h1><p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">Update planning assumptions without changing connected account observations.</p></header>
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 shadow-[var(--shadow-soft)] sm:p-7"><FinancialProfileForm profile={profile} mode="settings" saved={query.saved === "1"} /></section>
    <PersonalPlaidCredentials />
    <FinancialBriefing />
  </div></main>;
}

function ProfileLoadError() {
  return <main className="min-h-screen bg-[var(--bg)] px-4 py-8 text-[var(--text)] sm:px-8"><div className="mx-auto max-w-4xl">
    <Link href="/" className="text-sm text-[var(--text-muted)] hover:underline">← Dashboard</Link>
    <section className="mt-7 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900" role="alert">
      <h1 className="text-xl font-semibold">Your financial profile could not be loaded</h1>
      <p className="mt-2 text-sm leading-6">Your saved information was not changed. Please try again before entering or saving profile details.</p>
      <Link href="/settings/profile" className="mt-4 inline-block rounded border border-red-300 px-4 py-2 text-sm font-medium hover:bg-red-100">Try again</Link>
    </section>
  </div></main>;
}

function isProfile(value: unknown): value is FinancialProfile {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).currency === "string" && typeof (value as Record<string, unknown>).label === "string");
}
