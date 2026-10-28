import { NextResponse } from "next/server";
import { getAuthenticatedSupabaseContext } from "../../../lib/supabase/server";

export async function plaidDisabledResponse(request: Request) {
  const auth = await getAuthenticatedSupabaseContext(request);
  if (!auth) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ error: "Plaid integration is currently disabled." }, { status: 503 });
}
