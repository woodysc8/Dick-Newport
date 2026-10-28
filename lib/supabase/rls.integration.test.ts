import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const config = {
  enabled: process.env.DICK_NEWPORT_RLS_INTEGRATION === "1" && process.env.DICK_NEWPORT_TEST_USERS_ARE_DISPOSABLE === "yes",
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  emailA: process.env.DICK_NEWPORT_RLS_USER_A_EMAIL,
  passwordA: process.env.DICK_NEWPORT_RLS_USER_A_PASSWORD,
  idA: process.env.DICK_NEWPORT_RLS_USER_A_ID,
  emailB: process.env.DICK_NEWPORT_RLS_USER_B_EMAIL,
  passwordB: process.env.DICK_NEWPORT_RLS_USER_B_PASSWORD,
  idB: process.env.DICK_NEWPORT_RLS_USER_B_ID,
};

const isConfigured = Object.values(config).every(Boolean);
const integration = describe.skipIf(!isConfigured);

integration("Supabase owner RLS integration (dedicated test identities only)", () => {
  it("keeps financial-goal rows private and prevents cross-owner updates", async () => {
    const client = () => createClient(config.url!, config.key!, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });
    const userA = client();
    const userB = client();
    const [sessionA, sessionB] = await Promise.all([
      userA.auth.signInWithPassword({ email: config.emailA!, password: config.passwordA! }),
      userB.auth.signInWithPassword({ email: config.emailB!, password: config.passwordB! }),
    ]);
    if (sessionA.error || sessionB.error || !sessionA.data.user || !sessionB.data.user) throw new Error("Dedicated integration user authentication failed.");
    const idA = sessionA.data.user.id;
    const idB = sessionB.data.user.id;
    expect(idA).toBe(config.idA);
    expect(idB).toBe(config.idB);
    expect(idA).not.toBe(idB);

    const [profileA, profileB] = await Promise.all([
      userA.from("profiles").select("id").eq("id", idA).maybeSingle(),
      userB.from("profiles").select("id").eq("id", idB).maybeSingle(),
    ]);
    if (profileA.error || profileB.error || !profileA.data || !profileB.data) {
      throw new Error("Both disposable integration users must already have their own profile row.");
    }
    const [hiddenProfileA, hiddenProfileB] = await Promise.all([
      userA.from("profiles").select("id").eq("id", idB).maybeSingle(),
      userB.from("profiles").select("id").eq("id", idA).maybeSingle(),
    ]);
    expect(hiddenProfileA.error).toBeNull();
    expect(hiddenProfileB.error).toBeNull();
    expect(hiddenProfileA.data).toBeNull();
    expect(hiddenProfileB.data).toBeNull();

    const marker = `__dick_newport_rls_test__${crypto.randomUUID()}`;
    try {
      const insertA = await userA.from("financial_goals").insert({ user_id: idA, name: `${marker}:a`, target_amount: 123.45 });
      expect(insertA.error).toBeNull();
      const insertB = await userB.from("financial_goals").insert({ user_id: idB, name: `${marker}:b`, target_amount: 678.90 });
      expect(insertB.error).toBeNull();

      const [ownA, ownB, hiddenFromA, hiddenFromB] = await Promise.all([
        userA.from("financial_goals").select("user_id,name,target_amount").eq("name", `${marker}:a`),
        userB.from("financial_goals").select("user_id,name,target_amount").eq("name", `${marker}:b`),
        userA.from("financial_goals").select("user_id,name,target_amount").eq("name", `${marker}:b`),
        userB.from("financial_goals").select("user_id,name,target_amount").eq("name", `${marker}:a`),
      ]);
      expect(ownA.error).toBeNull();
      expect(ownB.error).toBeNull();
      expect(ownA.data).toEqual([{ user_id: idA, name: `${marker}:a`, target_amount: 123.45 }]);
      expect(ownB.data).toEqual([{ user_id: idB, name: `${marker}:b`, target_amount: 678.9 }]);
      expect(hiddenFromA.data).toEqual([]);
      expect(hiddenFromB.data).toEqual([]);

      const crossOwnerUpdate = await userA.from("financial_goals").update({ name: `${marker}:tampered` }).eq("name", `${marker}:b`).select("id");
      expect(crossOwnerUpdate.error).toBeNull();
      expect(crossOwnerUpdate.data).toEqual([]);
    } finally {
      await Promise.all([
        removeSyntheticRows(userA, idA, marker),
        removeSyntheticRows(userB, idB, marker),
        userA.auth.signOut(),
        userB.auth.signOut(),
      ]);
    }
  });
});

async function removeSyntheticRows(client: SupabaseClient, ownerId: string, marker: string) {
  const { error } = await client.from("financial_goals").delete().eq("user_id", ownerId).like("name", marker + ":%");
  if (error) throw new Error("Unable to clean up synthetic RLS integration rows.");
}
