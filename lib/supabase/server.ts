import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and publishable key are required");
  return { url, key };
}

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const { url, key } = getSupabaseConfig();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies; proxy.ts refreshes sessions.
        }
      },
    },
  });
}

export type AuthenticatedSupabaseContext = {
  supabase: SupabaseClient;
  user: User;
};

/** Verify the caller with Auth and return a publishable-key client bound to that user. */
export async function getAuthenticatedSupabaseContext(
  request?: Request,
  options: { requireBearer?: boolean } = {},
): Promise<AuthenticatedSupabaseContext | null> {
  const authorization = request?.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (options.requireBearer && !token) return null;

  const { url, key } = getSupabaseConfig();
  const supabase = token
    ? createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      })
    : await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser(token);

  return error || !data.user ? null : { supabase, user: data.user };
}

export async function ensureOwnProfile(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase
    .from("profiles")
    .upsert({ id: userId }, { onConflict: "id", ignoreDuplicates: true });
  if (error) throw new Error("Unable to initialize the authenticated user's profile");
}
