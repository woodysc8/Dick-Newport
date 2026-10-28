import { NextRequest, NextResponse } from "next/server";
import { FinancialContext, getFinancialContext } from "../../../lib/financialContext";
import { getAuthenticatedSupabaseContext } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

const VALID_SCOPES = ["networth", "accounts", "investments", "monthly", "transactions", "rewards", "freshness"] as const;
type FinancialContextScope = (typeof VALID_SCOPES)[number];

function parseScopes(value: string | null): FinancialContextScope[] | null {
  if (!value) return null;

  const scopes = value.split(",").map((scope) => scope.trim().toLowerCase()).filter(Boolean);
  return scopes.every((scope): scope is FinancialContextScope => VALID_SCOPES.includes(scope as FinancialContextScope))
    ? [...new Set(scopes)]
    : [];
}

function scopedContext(context: FinancialContext, scopes: FinancialContextScope[] | null) {
  if (scopes == null) return context;

  const response: Partial<FinancialContext> & Pick<FinancialContext, "generatedAt"> = {
    generatedAt: context.generatedAt,
  };
  const fields: Record<FinancialContextScope, keyof FinancialContext> = {
    networth: "netWorth",
    accounts: "accounts",
    investments: "investments",
    monthly: "monthly",
    transactions: "recentTransactions",
    rewards: "rewards",
    freshness: "freshness",
  };

  for (const scope of scopes) {
    response[fields[scope]] = context[fields[scope]] as never;
  }

  return response;
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedSupabaseContext(request);
  if (!auth) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const scopes = parseScopes(request.nextUrl.searchParams.get("scope"));
  if (scopes?.length === 0) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }

  const limitValue = request.nextUrl.searchParams.get("transactionLimit");
  const transactionLimit = limitValue == null ? undefined : Number(limitValue);
  if (transactionLimit != null && (!Number.isInteger(transactionLimit) || transactionLimit < 1 || transactionLimit > 200)) {
    return NextResponse.json({ error: "transactionLimit must be an integer from 1 to 200" }, { status: 400 });
  }

  try {
    const includeSnapshots = request.nextUrl.searchParams.get("includeSnapshots") === "true";
    const context = await getFinancialContext(auth.supabase, auth.user.id, { includeSnapshots, transactionLimit });
    return NextResponse.json(scopedContext(context, scopes));
  } catch (error) {
    console.error("Financial context request failed", error);
    return NextResponse.json({ error: "Failed to load financial context" }, { status: 500 });
  }
}
