import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "Plaid integration is currently disabled." }, { status: 503 });
}
