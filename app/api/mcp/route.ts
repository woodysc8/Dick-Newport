import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FinancialContext, getFinancialContext } from "../../../lib/financialContext";
import { AuthenticatedSupabaseContext, getAuthenticatedSupabaseContext } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FinancialContextScope = "networth" | "accounts" | "investments" | "monthly" | "transactions" | "rewards" | "freshness";
type FinancialContextRequest = { scope?: FinancialContextScope; includeSnapshots?: boolean; transactionLimit?: number };

function failedFinancialDataResult() {
  return { content: [{ type: "text" as const, text: "failed to fetch financial data" }], isError: true };
}

function scopedContext(context: FinancialContext, scopes?: FinancialContextScope[]) {
  if (!scopes) return context;
  const response: Partial<FinancialContext> & Pick<FinancialContext, "generatedAt"> = { generatedAt: context.generatedAt };
  const fields: Record<FinancialContextScope, keyof FinancialContext> = {
    networth: "netWorth", accounts: "accounts", investments: "investments", monthly: "monthly",
    transactions: "recentTransactions", rewards: "rewards", freshness: "freshness",
  };
  for (const scope of scopes) response[fields[scope]] = context[fields[scope]] as never;
  return response;
}

function contextTool(auth: AuthenticatedSupabaseContext, query: FinancialContextRequest = {}) {
  return async () => {
    try {
      const context = await getFinancialContext(auth.supabase, auth.user.id, query);
      return { content: [{ type: "text" as const, text: JSON.stringify(scopedContext(context, query.scope ? [query.scope] : undefined)) }] };
    } catch {
      return failedFinancialDataResult();
    }
  };
}

function createMcpServer(auth: AuthenticatedSupabaseContext) {
  const server = new McpServer({ name: "perfi-financial-context", version: "1.0.0" });
  server.registerTool("get_net_worth", {
    description: "Get current net worth, cash, credit-card debt, and investments. Use for balance-summary questions; it does not include accounts or transaction-level detail.",
  }, contextTool(auth, { scope: "networth" }));
  server.registerTool("get_monthly_budget", {
    description: "Get this month's canonical income, gross spending, net personal spending, refunds, transfers, credit-card payments, and spending categories. Use for monthly budget questions.",
  }, contextTool(auth, { scope: "monthly" }));
  server.registerTool("get_investments", {
    description: "Get the canonical investment total and current holdings. Set includeSnapshots only when historical investment snapshots are needed.",
    inputSchema: { includeSnapshots: z.boolean().optional().describe("Include historical investment snapshots when true.") },
  }, async ({ includeSnapshots }) => contextTool(auth, { scope: "investments", includeSnapshots })());
  server.registerTool("get_recent_transactions", {
    description: "Get recent transaction records only. Use for merchant, date, amount, pending-status, or transaction-level questions; do not use for net worth or budget summaries.",
    inputSchema: { limit: z.number().int().min(1).optional().describe("Maximum records to return; defaults to 50 and is capped at 200.") },
  }, async ({ limit }) => contextTool(auth, { scope: "transactions", transactionLimit: Math.min(limit ?? 50, 200) })());
  server.registerTool("get_rewards", {
    description: "Get Bilt Points, Bilt Cash, and Barclays Points balances. Unavailable balances are returned as null, never zero.",
  }, contextTool(auth, { scope: "rewards" }));
  server.registerTool("get_full_snapshot", {
    description: "Get the complete financial context across net worth, accounts, investments, monthly spending, transactions, rewards, and freshness. Use only when a question genuinely spans multiple domains; prefer the narrower scoped tools by default.",
  }, contextTool(auth));
  return server;
}

async function handleMcpRequest(request: NextRequest) {
  const auth = await getAuthenticatedSupabaseContext(request, { requireBearer: true });
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Use the verified session client directly; do not forward the user's bearer token to a Host-derived URL.
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createMcpServer(auth);
    await server.connect(transport);
    return await transport.handleRequest(request);
  } catch {
    return NextResponse.json({ error: "failed to fetch financial data" }, { status: 500 });
  }
}

export const POST = handleMcpRequest;
export const GET = handleMcpRequest;
export const DELETE = handleMcpRequest;
