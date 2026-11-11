import { NextResponse } from "next/server";
import { getAuthenticatedSupabaseContext } from "../../../lib/supabase/server";
import { isSameOriginRequest } from "../../../lib/requestSecurity";

export async function plaidDisabledResponse(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  const auth = await getAuthenticatedSupabaseContext(request);
  if (!auth) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ error: "Plaid integration is currently disabled." }, { status: 503 });
}
