import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient, ensureOwnProfile } from "../../../lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login?error=callback", request.url));

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL("/login?error=callback", request.url));

  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.redirect(new URL("/login?error=callback", request.url));
  await ensureOwnProfile(supabase, data.user.id);
  return NextResponse.redirect(new URL("/onboarding", request.url));
}
