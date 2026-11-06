import { NextResponse } from "next/server";
import { createLinkTokenRequest, createPlaidClient } from "../../../../lib/plaidClient";
import { getAuthenticatedPlaidContext, type PlaidContextCreationStage } from "../../../../lib/plaidTenant";

type LinkTokenStage = PlaidContextCreationStage | "Plaid client configuration" | "linkTokenCreate";

type UnknownRecord = Record<string, unknown>;

const SAFE_ERROR_NAMES = new Set([
  "Error",
  "TypeError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "URIError",
  "EvalError",
  "AggregateError",
  "AxiosError",
  "FetchError",
]);

const SAFE_ERROR_MESSAGES = new Set([
  "Plaid environment is not configured",
  "Plaid credentials are not configured",
  "Supabase URL and publishable key are required",
  "Supabase service credentials are required for Plaid operations",
  "Unable to initialize the authenticated user's profile",
  "Network Error",
  "fetch failed",
]);

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? value as UnknownRecord : null;
}

function safeText(value: unknown, pattern: RegExp, maxLength: number): string | undefined {
  return typeof value === "string" && value.length <= maxLength && pattern.test(value)
    ? value
    : undefined;
}

function safeErrorMessage(error: unknown): string | undefined {
  const message = asRecord(error)?.message;
  if (typeof message !== "string") return undefined;

  if (SAFE_ERROR_MESSAGES.has(message)) return message;
  if (/^Request failed with status code [1-5]\d{2}$/.test(message)) return message;
  if (/^timeout of \d{1,6}ms exceeded$/.test(message)) return message;
  return undefined;
}

function safeDiagnostic(stage: LinkTokenStage, error: unknown) {
  const errorRecord = asRecord(error);
  const response = asRecord(errorRecord?.response);
  const responseData = asRecord(response?.data);
  const responseHeaders = asRecord(response?.headers);
  const errorName = typeof errorRecord?.name === "string" && SAFE_ERROR_NAMES.has(errorRecord.name)
    ? errorRecord.name
    : undefined;
  const status = typeof response?.status === "number" && Number.isInteger(response.status)
    && response.status >= 100 && response.status <= 599
    ? response.status
    : undefined;
  const errorType = safeText(responseData?.error_type, /^[A-Z0-9_]{1,64}$/, 64);
  const errorCode = safeText(responseData?.error_code, /^[A-Z0-9_]{1,64}$/, 64);
  const requestId = safeText(
    responseData?.request_id ?? responseHeaders?.["plaid-request-id"] ?? responseHeaders?.["Plaid-Request-ID"],
    /^[A-Za-z0-9_-]{1,128}$/,
    128,
  );
  const message = safeErrorMessage(error);

  return {
    stage,
    ...(errorName ? { errorName } : {}),
    ...(status !== undefined ? { httpStatus: status } : {}),
    ...(errorType ? { plaidErrorType: errorType } : {}),
    ...(errorCode ? { plaidErrorCode: errorCode } : {}),
    ...(requestId ? { plaidRequestId: requestId } : {}),
    ...(message ? { message } : {}),
  };
}

export async function POST(request: Request) {
  let stage: LinkTokenStage = "authenticated Supabase context creation";

  try {
    const context = await getAuthenticatedPlaidContext(request, (contextStage) => {
      stage = contextStage;
    });
    if (!context) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    stage = "Plaid client configuration";
    const plaidClient = createPlaidClient();

    stage = "linkTokenCreate";
    const response = await plaidClient.linkTokenCreate(createLinkTokenRequest(context.userId));
    return NextResponse.json({ link_token: response.data.link_token, expiration: response.data.expiration });
  } catch (error) {
    console.error("Plaid Link token creation failed", safeDiagnostic(stage, error));
    return NextResponse.json({ error: "Unable to create Plaid Link token" }, { status: 500 });
  }
}
