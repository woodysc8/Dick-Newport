"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient, ensureOwnProfile } from "../../lib/supabase/server";

function credentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !email.includes("@") || password.length < 8) redirect("/login?error=credentials");
  return { email, password };
}

export async function signIn(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { email, password } = credentials(formData);
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login?error=signin");

  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?error=signin");
  await ensureOwnProfile(supabase, data.user.id);
  redirect("/");
}

export async function signUp(formData: FormData) {
  const supabase = await createSupabaseServerClient();
  const { email, password } = credentials(formData);
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: new URL("/auth/callback", origin).toString() },
  });
  if (error) redirect("/login?error=signup");
  if (data.session && data.user) {
    await ensureOwnProfile(supabase, data.user.id);
    redirect("/onboarding");
  }
  redirect("/login?notice=confirm-email");
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
