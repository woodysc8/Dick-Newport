import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getAuthenticatedSupabaseContext } from "./supabase/server";
import { CredentialConfigurationError } from "./plaidCredentialConfiguration";
import { authorizedCron, financialServiceClient } from "./financialJobs";

const plaidUserContextBrand = Symbol("PlaidUserContext");
const authenticatedPlaidContexts = new WeakSet<object>();

export type PlaidUserContext = {
  userId: string;
  supabase: SupabaseClient;
  readonly [plaidUserContextBrand]: true;
};

export type PlaidItemPublicData = {
  id: string;
  plaid_item_id: string;
  institution_name: string | null;
};

export type PlaidItemOwnershipResult = {
  item: PlaidItemPublicData | null;
  error: Error | null;
};

export type PlaidContextCreationStage =
  | "authenticated Supabase context creation"
  | "authenticated Plaid context creation";

export function isAuthenticatedPlaidContext(value: unknown): value is PlaidUserContext {
  return typeof value === "object" && value !== null && authenticatedPlaidContexts.has(value);
}

/** Delegation is available only after server-secret authentication AND explicit owner opt-in. */
export async function getScheduledPlaidContext(request: Request): Promise<PlaidUserContext | null> {
  if (!authorizedCron(request) || process.env.SCHEDULED_FINANCE_ENABLED !== "true") return null;
  const userId = process.env.SCHEDULED_FINANCE_OWNER_USER_ID;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const supabase = financialServiceClient();
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data.user || data.user.id !== userId || (data.user.banned_until && Date.parse(data.user.banned_until) > Date.now())) return null;
  const context = Object.freeze({ userId, supabase, [plaidUserContextBrand]: true as const });
  authenticatedPlaidContexts.add(context);
  return context;
}

/**
 * Establishes the authenticated user boundary for server-side Plaid work.
 * The returned client is privileged and must never be passed to browser code.
 */
export async function getAuthenticatedPlaidContext(
  request: Request,
  onStage?: (stage: PlaidContextCreationStage) => void,
): Promise<PlaidUserContext | null> {
  onStage?.("authenticated Supabase context creation");
  const auth = await getAuthenticatedSupabaseContext(request);
  if (!auth) return null;

  onStage?.("authenticated Plaid context creation");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new CredentialConfigurationError("SERVICE_CONFIGURATION_INVALID");

  const context = Object.freeze({
    userId: auth.user.id,
    supabase: createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    [plaidUserContextBrand]: true as const,
  });
  authenticatedPlaidContexts.add(context);
  return context;
}

/**
 * Checks ownership using both the verified user ID and submitted Item ID.
 * Access tokens are intentionally excluded from the select list and result.
 */
export async function verifyPlaidItemOwnership(
  supabase: SupabaseClient,
  userId: string,
  plaidItemId: string,
): Promise<PlaidItemOwnershipResult> {
  const { data, error } = await supabase
    .from("plaid_items")
    .select("id, plaid_item_id, institution_name")
    .eq("user_id", userId)
    .eq("plaid_item_id", plaidItemId)
    .maybeSingle();

  if (error) return { item: null, error: new Error("Plaid Item ownership lookup failed") };
  if (!data) return { item: null, error: null };
  return {
    item: {
      id: data.id,
      plaid_item_id: data.plaid_item_id,
      institution_name: data.institution_name ?? null,
    },
    error: null,
  };
}
