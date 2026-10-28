"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { STARTER_FINANCIAL_PROFILE, type FinancialProfile } from "../../lib/financialProfileDefaults";
import { parseFinancialProfileIntake, persistFinancialProfile } from "../../lib/financialProfileIntake";
import { ensureOwnProfile, getAuthenticatedSupabaseContext } from "../../lib/supabase/server";

export type ProfileActionState = { errors: Record<string, string>; message?: string };

export async function saveFinancialProfile(_previous: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  const auth = await getAuthenticatedSupabaseContext();
  if (!auth) redirect("/login");

  await ensureOwnProfile(auth.supabase, auth.user.id);
  const { data, error } = await auth.supabase.from("profiles")
    .select("financial_profile")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error) return { errors: {}, message: "We could not load your saved profile. Please try again." };

  const current = isProfile(data?.financial_profile) ? data.financial_profile : STARTER_FINANCIAL_PROFILE;
  const parsed = parseFinancialProfileIntake(formData, current);
  if (!parsed.profile) return parsed;

  const profile: FinancialProfile = { ...parsed.profile, onboardingCompletedAt: new Date().toISOString() };
  try {
    const saved = await persistFinancialProfile(auth.supabase, auth.user.id, profile);
    if (!saved) return { errors: {}, message: "Your profile row was not available to save. Refresh and try again." };
  } catch {
    return { errors: {}, message: "We could not save your profile. Please try again." };
  }

  revalidatePath("/");
  revalidatePath("/onboarding");
  revalidatePath("/settings/profile");
  const destination = formData.get("returnTo") === "settings" ? "/settings/profile?saved=1" : "/";
  redirect(destination);
}

function isProfile(value: unknown): value is FinancialProfile {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).currency === "string" &&
    typeof (value as Record<string, unknown>).label === "string");
}
