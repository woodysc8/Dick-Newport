import Link from "next/link";
import { redirect } from "next/navigation";
import FinancialProfileForm from "../components/FinancialProfileForm";
import { STARTER_FINANCIAL_PROFILE, type FinancialProfile } from "../../lib/financialProfileDefaults";
import { createSupabaseServerClient, ensureOwnProfile } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  await ensureOwnProfile(supabase, auth.user.id);
  const { data } = await supabase.from("profiles").select("financial_profile").eq("id", auth.user.id).maybeSingle();
  const profile = isProfile(data?.financial_profile) ? data.financial_profile : STARTER_FINANCIAL_PROFILE;

  return <main className="min-h-screen bg-[var(--bg)] px-4 py-8 text-[var(--text)] sm:px-8">
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="text-sm text-[var(--text-muted)] hover:underline">← Dashboard</Link>
      <header className="my-7"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent-ink)]">Personalize your plan</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Your financial profile</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">These optional answers shape your planning view. Leave anything blank if you do not know it yet. You can revise everything later.</p></header>
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-7">
        {profile.onboardingCompletedAt ? <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status">Setup complete. Your answers can be revised below at any time.</div> : <div className="mb-6 rounded-lg border border-[var(--border)] bg-white p-4 text-sm leading-6 text-[var(--text-muted)]">No values have been filled in for you. Enter only what you want to use in your plan.</div>}
        <FinancialProfileForm profile={profile} mode="onboarding" />
      </section>
    </div>
  </main>;
}

function isProfile(value: unknown): value is FinancialProfile {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).currency === "string" && typeof (value as Record<string, unknown>).label === "string");
}
