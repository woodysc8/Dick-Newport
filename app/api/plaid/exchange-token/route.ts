import { NextResponse } from "next/server";
import { createPlaidClient } from "../../../../lib/plaidClient";
import { getAuthenticatedPlaidContext } from "../../../../lib/plaidTenant";

export async function POST(request: Request) {
  const context = await getAuthenticatedPlaidContext(request);
  if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A valid public token is required" }, { status: 400 });
  }
  const publicToken = body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).public_token
    : null;
  if (typeof publicToken !== "string" || publicToken.trim().length === 0 || publicToken.length > 512) {
    return NextResponse.json({ error: "A valid public token is required" }, { status: 400 });
  }

  try {
    const plaidResponse = await createPlaidClient().itemPublicTokenExchange({
      public_token: publicToken.trim(),
    });
    const { item_id: plaidItemId, access_token: accessToken } = plaidResponse.data;
    const { data: existingItem, error: existingError } = await context.supabase
      .from("plaid_items")
      .select("user_id, institution_name")
      .eq("plaid_item_id", plaidItemId)
      .maybeSingle();
    if (existingError) throw new Error("Plaid Item lookup failed");
    if (existingItem && existingItem.user_id !== context.userId) {
      return NextResponse.json({ error: "This Plaid Item is already connected to another user" }, { status: 409 });
    }

    const itemData = {
      user_id: context.userId,
      plaid_item_id: plaidItemId,
      access_token: accessToken,
      institution_name: existingItem?.institution_name ?? null,
      updated_at: new Date().toISOString(),
    };
    const persistence = existingItem
      ? context.supabase.from("plaid_items").update(itemData).eq("plaid_item_id", plaidItemId).eq("user_id", context.userId)
      : context.supabase.from("plaid_items").insert(itemData);
    const { error: persistenceError } = await persistence;
    if (persistenceError) throw new Error("Plaid Item persistence failed");

    return NextResponse.json({
      connected: true,
      plaid_item_id: plaidItemId,
      institution_name: existingItem?.institution_name ?? null,
    });
  } catch {
    return NextResponse.json({ error: "Unable to save Plaid connection" }, { status: 500 });
  }
}
