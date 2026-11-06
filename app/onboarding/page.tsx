import Link from "next/link";
import { redirect } from "next/navigation";
import FinancialProfileForm from "../components/FinancialProfileForm";
import { STARTER_FINANCIAL_PROFILE, type FinancialProfile } from "../../lib/financialProfileDefaults";
import { normalizeFinancialProfile } from "../../lib/financialProfileNormalization";
import { createSupabaseServerClient, ensureOwnProfile } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");
  await ensureOwnProfile(supabase, auth.user.id);
  const { data, error } = await supabase.from("profiles").select("financial_profile").eq("id", auth.user.id).maybeSingle();
  if (error) {
    return <ProfileLoadError href="/onboarding" />;
  }
  const profile = normalizeFinancialProfile(isProfile(data?.financial_profile) ? data.financial_profile : STARTER_FINANCIAL_PROFILE);

  return <main className="min-h-screen bg-[var(--bg)] px-4 py-7 text-[var(--text)] sm:px-8 sm:py-10">
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="text-sm text-[var(--text-muted)] hover:underline">Skip profile setup and open dashboard</Link>
      <header className="my-7"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">Personalize your plan</p><h1 className="mt-2 text-4xl font-semibold tracking-[-0.05em]">Your financial profile</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">Add only what you know. Your profile estimates remain separate from connected financial data.</p></header>
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4 shadow-[var(--shadow-soft)] sm:p-7">
        {profile.onboardingCompletedAt ? <div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900" role="status">Setup complete. Your answers can be revised below at any time.</div> : <div className="mb-6 rounded-lg border border-[var(--border)] bg-white p-4 text-sm leading-6 text-[var(--text-muted)]">No values have been filled in for you. Enter only what you want to use in your plan.</div>}
        <FinancialProfileForm profile={profile} mode="onboarding" />
      </section>
    </div>
  </main>;
}

function ProfileLoadError({ href }: { href: string }) {
  return <main className="min-h-screen bg-[var(--bg)] px-4 py-8 text-[var(--text)] sm:px-8">
    <div className="mx-auto max-w-4xl">
      <Link href="/" className="text-sm text-[var(--text-muted)] hover:underline">← Dashboard</Link>
      <section className="mt-7 rounded-2xl border border-red-200 bg-red-50 p-6 text-red-900" role="alert">
        <h1 className="text-xl font-semibold">Your financial profile could not be loaded</h1>
        <p className="mt-2 text-sm leading-6">Your saved information was not changed. Please try again before entering or saving profile details.</p>
        <Link href={href} className="mt-4 inline-block rounded border border-red-300 px-4 py-2 text-sm font-medium hover:bg-red-100">Try again</Link>
      </section>
    </div>
  </main>;
}

function isProfile(value: unknown): value is FinancialProfile {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).currency === "string" && typeof (value as Record<string, unknown>).label === "string");
}
