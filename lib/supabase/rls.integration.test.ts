import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const blockedDevelopmentProjectRef = "oomfxfdtnssaalfqaknz";
const permittedHostedTestProjectRef = "bzfssrtdrqtqirfkwakf";
const localSupabaseOrigins = new Set([
  "http://127.0.0.1:54321",
  "http://localhost:54321",
]);

const config = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  adminKey: process.env.DICK_NEWPORT_RLS_TEST_ADMIN_KEY,
  expectedProjectRef: process.env.DICK_NEWPORT_RLS_EXPECTED_PROJECT_REF,
  emailA: process.env.DICK_NEWPORT_RLS_USER_A_EMAIL,
  passwordA: process.env.DICK_NEWPORT_RLS_USER_A_PASSWORD,
  idA: process.env.DICK_NEWPORT_RLS_USER_A_ID,
  emailB: process.env.DICK_NEWPORT_RLS_USER_B_EMAIL,
  passwordB: process.env.DICK_NEWPORT_RLS_USER_B_PASSWORD,
  idB: process.env.DICK_NEWPORT_RLS_USER_B_ID,
};

const explicitlyInvoked = process.env.npm_lifecycle_event === "test:rls";
const configurationProblems = getConfigurationProblems();
const isConfigured = configurationProblems.length === 0;
const integration = explicitlyInvoked
  ? describe
  : isConfigured
    ? describe
    : describe.skip;

type FinancialTable =
  | "accounts"
  | "transactions"
  | "budgets"
  | "financial_goals"
  | "financial_settings"
  | "investment_holdings"
  | "investment_snapshots";

type FixtureSpec = {
  markerColumn: string;
  keyColumn: string;
  makeMarker: (marker: string, suffix: string) => string | number;
  create: (userId: string, marker: string | number, accountId?: string) => Record<string, unknown>;
  update: (marker: string | number) => Record<string, unknown>;
  changeOwner: (userId: string, accountId?: string) => Record<string, unknown>;
};

const tableSpecs: Record<FinancialTable, FixtureSpec> = {
  accounts: {
    markerColumn: "account_name",
    keyColumn: "id",
    makeMarker: (marker, suffix) => `${marker}:accounts:${suffix}`,
    create: (user_id, account_name) => ({
      user_id,
      institution_name: "Synthetic RLS Test Institution",
      account_name,
      account_type: "depository",
      current_balance: 101.25,
    }),
    update: (account_name) => ({ account_name, current_balance: 202.5 }),
    changeOwner: (user_id) => ({ user_id }),
  },
  transactions: {
    markerColumn: "name",
    keyColumn: "id",
    makeMarker: (marker, suffix) => `${marker}:transactions:${suffix}`,
    create: (user_id, name, account_id) => ({
      user_id,
      account_id,
      date: "2026-01-15",
      name,
      amount: 12.34,
      category: "synthetic-test",
    }),
    update: (name) => ({ name, amount: 56.78 }),
    changeOwner: (user_id, account_id) => ({ user_id, account_id }),
  },
  budgets: {
    markerColumn: "category",
    keyColumn: "id",
    makeMarker: (marker, suffix) => `${marker}:budgets:${suffix}`,
    create: (user_id, category) => ({ user_id, category, monthly_limit: 321.09 }),
    update: (category) => ({ category, monthly_limit: 654.32 }),
    changeOwner: (user_id) => ({ user_id }),
  },
  financial_goals: {
    markerColumn: "name",
    keyColumn: "id",
    makeMarker: (marker, suffix) => `${marker}:financial_goals:${suffix}`,
    create: (user_id, name) => ({ user_id, name, target_amount: 1000.01 }),
    update: (name) => ({ name, target_amount: 2000.02 }),
    changeOwner: (user_id) => ({ user_id }),
  },
  financial_settings: {
    markerColumn: "monthly_income",
    keyColumn: "user_id",
    makeMarker: (marker, suffix) => {
      const offset = ["own-a", "own-b", "forged-a", "forged-b", "anonymous-a", "anonymous-b", "cross-update-a", "cross-update-b", "anonymous-update-a", "anonymous-update-b", "own-update-a", "own-update-b"]
        .indexOf(suffix) + 1;
      const runId = marker.split("__").at(-1)!.replaceAll("-", "");
      return Number.parseInt(runId.slice(0, 8), 16) * 100 + offset;
    },
    create: (user_id, monthly_income) => ({ user_id, monthly_income, emergency_fund_target: 456.78 }),
    update: (monthly_income) => ({ monthly_income, emergency_fund_target: 876.54 }),
    changeOwner: (user_id) => ({ user_id }),
  },
  investment_holdings: {
    markerColumn: "security_id",
    keyColumn: "id",
    makeMarker: (marker, suffix) => `${marker}:investment_holdings:${suffix}`,
    create: (user_id, security_id) => ({
      user_id,
      security_id,
      ticker_symbol: "RLS",
      security_name: "Synthetic RLS Test Security",
      quantity: 1.25,
      institution_value: 123.45,
    }),
    update: (security_id) => ({ security_id, institution_value: 543.21 }),
    changeOwner: (user_id) => ({ user_id }),
  },
  investment_snapshots: {
    markerColumn: "plaid_item_id",
    keyColumn: "id",
    makeMarker: (marker, suffix) => `${marker}:investment_snapshots:${suffix}`,
    create: (user_id, plaid_item_id) => ({
      user_id,
      plaid_item_id,
      plaid_account_id: `${plaid_item_id}:account`,
      snapshot_date: "2026-01-15",
      portfolio_value: 321.45,
      securities_value: 234.56,
    }),
    update: (plaid_item_id) => ({
      plaid_item_id,
      plaid_account_id: `${plaid_item_id}:account-updated`,
      portfolio_value: 654.32,
      securities_value: 543.21,
    }),
    changeOwner: (user_id) => ({ user_id }),
  },
};

integration("Supabase RLS integration (disposable target only)", () => {
  it("isolates every client-accessible financial table between two users", async () => {
    if (!isConfigured) {
      throw new Error(`RLS integration configuration is incomplete or invalid:\n- ${configurationProblems.join("\n- ")}`);
    }
    // This synchronous guard runs before client construction, authentication, or database requests.
    assertSafeTarget(config.url!, config.expectedProjectRef);

    const clientOptions = {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    };
    const userA = createClient(config.url!, config.publishableKey!, clientOptions);
    const userB = createClient(config.url!, config.publishableKey!, clientOptions);
    const anonymous = createClient(config.url!, config.publishableKey!, clientOptions);
    const admin = createClient(config.url!, config.adminKey!, clientOptions);

    const [sessionA, sessionB] = await Promise.all([
      userA.auth.signInWithPassword({ email: config.emailA!, password: config.passwordA! }),
      userB.auth.signInWithPassword({ email: config.emailB!, password: config.passwordB! }),
    ]);
    if (sessionA.error || sessionB.error || !sessionA.data.user || !sessionB.data.user) {
      const describeAuthFailure = (
        label: string,
        error: { name?: string; message?: string; status?: number; code?: string } | null,
        user: unknown,
      ) => [
        `User ${label}:`,
        `  error name: ${error?.name ?? "none"}`,
        `  error message: ${error?.message ?? "none"}`,
        `  HTTP status: ${error?.status ?? "not available"}`,
        `  Supabase error code: ${error?.code ?? "not available"}`,
        `  user object returned: ${user ? "yes" : "no"}`,
      ].join("\n");
      const authenticationFailure = [
        describeAuthFailure("A", sessionA.error, sessionA.data.user),
        describeAuthFailure("B", sessionB.error, sessionB.data.user),
      ].join("\n");
      await signOutAll([userA, userB, anonymous]);
      throw new Error(`Disposable RLS integration user authentication failed:\n${authenticationFailure}`);
    }

    const idA = sessionA.data.user.id;
    const idB = sessionB.data.user.id;
    if (idA !== config.idA || idB !== config.idB || idA === idB) {
      await signOutAll([userA, userB, anonymous]);
      throw new Error("Authenticated RLS test identities did not match their configured disposable IDs.");
    }

    const marker = `__dick_newport_rls_test__${crypto.randomUUID()}`;
    const markerValues = new Map<string, Set<string | number>>();
    const createdFixtures: Array<{ table: string; keyColumn: string; key: string }> = [];
    const accountIds: Record<string, string> = {};
    const profileRowsCreated: string[] = [];
    let cleanupPermitted = false;
    let testError: unknown;

    try {
      await assertDedicatedUsersHaveNoFinancialData(admin, [idA, idB]);
      cleanupPermitted = true;

      // Profiles are inserted by the users themselves. The empty-data precondition makes
      // them test-created rows, which the admin cleanup can safely remove afterward.
      for (const [owner, userId, client] of [["a", idA, userA], ["b", idB, userB]] as const) {
        const profile = await client.from("profiles").insert({
          id: userId,
          full_name: `${marker}:profile:${owner}`,
          financial_profile: { rlsTestMarker: marker, owner },
        }).select("*").single();
        if (profile.data?.id === userId) {
          profileRowsCreated.push(userId);
          createdFixtures.push({ table: "profiles", keyColumn: "id", key: userId });
        }
        expect(profile.error).toBeNull();
        expect(profile.data?.id).toBe(userId);
      }

      await testProfileIsolation({ userA, userB, anonymous, admin, idA, idB, marker, profileRowsCreated });

      // Transactions use a synthetic account owned by the same user, satisfying the composite FK.
      for (const [owner, userId, client] of [["a", idA, userA], ["b", idB, userB]] as const) {
        const accountMarker = `__dick_newport_rls_test__${marker}:transactions-parent:${owner}`;
        rememberMarker(markerValues, "accounts", accountMarker);
        const result = await client.from("accounts").insert(tableSpecs.accounts.create(userId, accountMarker))
          .select("id,user_id").single();
        expect(result.error).toBeNull();
        expect(result.data?.user_id).toBe(userId);
        accountIds[owner] = result.data!.id;
        createdFixtures.push({ table: "accounts", keyColumn: "id", key: result.data!.id });
      }

      for (const table of Object.keys(tableSpecs) as FinancialTable[]) {
        await testFinancialTable({
          table,
          userA,
          userB,
          anonymous,
          admin,
          idA,
          idB,
          marker,
          markerValues,
          createdFixtures,
          accountIdA: accountIds.a,
          accountIdB: accountIds.b,
        });
      }

      await testPlaidItemsAreClientInaccessible({
        userA, userB, anonymous, admin, idA, idB, marker, markerValues, createdFixtures,
      });
    } catch (error) {
      testError = error;
      throw error;
    } finally {
      const cleanupErrors: string[] = [];
      if (cleanupPermitted) {
        try {
          await cleanupSyntheticData(admin, [idA, idB], markerValues, createdFixtures, profileRowsCreated);
        } catch (error) {
          cleanupErrors.push(error instanceof Error ? error.message : "Unknown data cleanup error.");
        }
      }
      try {
        await signOutAll([userA, userB, anonymous]);
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : "Unknown sign-out cleanup error.");
      }
      if (cleanupErrors.length > 0) {
        const originalFailure = testError instanceof Error ? ` Original failure: ${testError.message}` : "";
        throw new Error(
          `RLS integration cleanup failed${testError ? " after a test failure" : ""}: ${cleanupErrors.join("; ")}.${originalFailure}`,
        );
      }
    }
  });
});

async function testProfileIsolation(args: {
  userA: SupabaseClient;
  userB: SupabaseClient;
  anonymous: SupabaseClient;
  admin: SupabaseClient;
  idA: string;
  idB: string;
  marker: string;
  profileRowsCreated: string[];
}) {
  const { userA, userB, anonymous, admin, idA, idB, marker } = args;
  const [ownA, ownB, crossA, crossB, anonA, anonB] = await Promise.all([
    userA.from("profiles").select("id,full_name,financial_profile").eq("id", idA).maybeSingle(),
    userB.from("profiles").select("id,full_name,financial_profile").eq("id", idB).maybeSingle(),
    userA.from("profiles").select("id").eq("id", idB),
    userB.from("profiles").select("id").eq("id", idA),
    anonymous.from("profiles").select("id").eq("id", idA),
    anonymous.from("profiles").select("id").eq("id", idB),
  ]);
  expect(ownA.error).toBeNull();
  expect(ownA.data?.id).toBe(idA);
  expect(ownB.error).toBeNull();
  expect(ownB.data?.id).toBe(idB);
  expect(crossA.error).toBeNull();
  expect(crossA.data).toEqual([]);
  expect(crossB.error).toBeNull();
  expect(crossB.data).toEqual([]);
  expectBlocked(anonA);
  expectBlocked(anonB);

  const forgedInsertA = await userA.from("profiles").insert({
    id: idB,
    full_name: `${marker}:profile-forged-a`,
  }).select("id");
  const forgedInsertB = await userB.from("profiles").insert({
    id: idA,
    full_name: `${marker}:profile-forged-b`,
  }).select("id");
  expectRlsDenial(forgedInsertA);
  expectRlsDenial(forgedInsertB);

  const crossUpdateA = await userA.from("profiles").update({ full_name: `${marker}:profile-cross-a` })
    .eq("id", idB).select("id");
  const crossUpdateB = await userB.from("profiles").update({ full_name: `${marker}:profile-cross-b` })
    .eq("id", idA).select("id");
  expectBlocked(crossUpdateA);
  expectBlocked(crossUpdateB);

  const anonymousInsert = await anonymous.from("profiles").insert({
    id: idA,
    full_name: `${marker}:profile-anonymous`,
  }).select("id");
  expectBlocked(anonymousInsert);
  const anonymousUpdates = await Promise.all([
    anonymous.from("profiles").update({ full_name: `${marker}:profile-anon-update-a` }).eq("id", idA).select("id"),
    anonymous.from("profiles").update({ full_name: `${marker}:profile-anon-update-b` }).eq("id", idB).select("id"),
  ]);
  anonymousUpdates.forEach(expectBlocked);

  // id is the ownership key. Both users attempt to transfer their disposable profile
  // to the other user's existing ID; WITH CHECK must reject the new ownership.
  const ownershipChanges = await Promise.all([
    userA.from("profiles").update({ id: idB }).eq("id", idA).select("id"),
    userB.from("profiles").update({ id: idA }).eq("id", idB).select("id"),
  ]);
  ownershipChanges.forEach(expectRlsDenial);

  const ownUpdates = await Promise.all([
    userA.from("profiles").update({ full_name: `${marker}:profile-own-a` }).eq("id", idA).select("id,full_name"),
    userB.from("profiles").update({ full_name: `${marker}:profile-own-b` }).eq("id", idB).select("id,full_name"),
  ]);
  expect(ownUpdates[0].error).toBeNull();
  expect(ownUpdates[0].data).toEqual([{ id: idA, full_name: `${marker}:profile-own-a` }]);
  expect(ownUpdates[1].error).toBeNull();
  expect(ownUpdates[1].data).toEqual([{ id: idB, full_name: `${marker}:profile-own-b` }]);

  const [verifiedA, verifiedB, leakedForgedRows] = await Promise.all([
    admin.from("profiles").select("id,full_name,financial_profile").in("id", [idA]),
    admin.from("profiles").select("id,full_name,financial_profile").in("id", [idB]),
    admin.from("profiles").select("id").in("full_name", [
      `${marker}:profile-forged-a`, `${marker}:profile-forged-b`, `${marker}:profile-anonymous`,
      `${marker}:profile-cross-a`, `${marker}:profile-cross-b`, `${marker}:profile-anon-update-a`, `${marker}:profile-anon-update-b`,
    ]),
  ]);
  expect(verifiedA.error).toBeNull();
  expect(verifiedA.data).toHaveLength(1);
  expect(verifiedA.data?.[0].id).toBe(idA);
  expect(verifiedA.data?.[0].full_name).toBe(`${marker}:profile-own-a`);
  expect(verifiedB.error).toBeNull();
  expect(verifiedB.data).toHaveLength(1);
  expect(verifiedB.data?.[0].id).toBe(idB);
  expect(verifiedB.data?.[0].full_name).toBe(`${marker}:profile-own-b`);
  expect(leakedForgedRows.error).toBeNull();
  expect(leakedForgedRows.data).toEqual([]);
  expect(args.profileRowsCreated).toEqual([idA, idB]);
}

async function testFinancialTable(args: {
  table: FinancialTable;
  userA: SupabaseClient;
  userB: SupabaseClient;
  anonymous: SupabaseClient;
  admin: SupabaseClient;
  idA: string;
  idB: string;
  marker: string;
  markerValues: Map<string, Set<string | number>>;
  createdFixtures: Array<{ table: string; keyColumn: string; key: string }>;
  accountIdA: string;
  accountIdB: string;
}) {
  const {
    table, userA, userB, anonymous, admin, idA, idB, marker,
    markerValues, createdFixtures, accountIdA, accountIdB,
  } = args;
  const spec = tableSpecs[table];
  const markerFor = (suffix: string) => {
    const value = spec.makeMarker(marker, suffix);
    rememberMarker(markerValues, table, value);
    return value;
  };
  const accountFor = (ownerId: string) => ownerId === idA ? accountIdA : accountIdB;
  const createOwn = async (client: SupabaseClient, userId: string, suffix: string) => {
    const value = markerFor(suffix);
    const result = await client.from(table)
      .insert(spec.create(userId, value, accountFor(userId))).select("*").single();
    expect(result.error).toBeNull();
    expect(result.data?.user_id).toBe(userId);
    expect(result.data?.[spec.markerColumn]).toBe(value);
    createdFixtures.push({ table, keyColumn: spec.keyColumn, key: String(result.data?.[spec.keyColumn]) });
    return { value, row: result.data! };
  };
  const readByMarker = (client: SupabaseClient, userId: string, value: string | number) => client.from(table)
    .select("*").eq("user_id", userId).eq(spec.markerColumn, value);
  const assertNoMarkerInDatabase = async (value: string | number) => {
    const { data, error } = await admin.from(table).select(spec.keyColumn).eq(spec.markerColumn, value);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  };

  const ownA = await createOwn(userA, idA, "own-a");
  const ownB = await createOwn(userB, idB, "own-b");
  const [readA, readB, hiddenA, hiddenB] = await Promise.all([
    readByMarker(userA, idA, ownA.value),
    readByMarker(userB, idB, ownB.value),
    readByMarker(userA, idB, ownB.value),
    readByMarker(userB, idA, ownA.value),
  ]);
  expect(readA.error).toBeNull();
  expect(readA.data).toHaveLength(1);
  expect(readB.error).toBeNull();
  expect(readB.data).toHaveLength(1);
  expect(hiddenA.error).toBeNull();
  expect(hiddenA.data).toEqual([]);
  expect(hiddenB.error).toBeNull();
  expect(hiddenB.data).toEqual([]);

  const anonymousReads = await Promise.all([
    readByMarker(anonymous, idA, ownA.value),
    readByMarker(anonymous, idB, ownB.value),
  ]);
  anonymousReads.forEach(expectBlocked);

  for (const [client, targetId, targetAccount, suffix] of [
    [userA, idB, accountIdB, "forged-a"],
    [userB, idA, accountIdA, "forged-b"],
    [anonymous, idA, accountIdA, "anonymous-a"],
    [anonymous, idB, accountIdB, "anonymous-b"],
  ] as const) {
    const forgedValue = markerFor(suffix);
    const result = await client.from(table)
      .insert(spec.create(targetId, forgedValue, targetAccount)).select("*");
    expectBlocked(result);
    await assertNoMarkerInDatabase(forgedValue);
  }

  // Move each user's row toward the other owner. For transactions, the account is
  // changed too so the composite account-owner FK cannot mask a policy result.
  for (const [client, currentId, targetId, targetAccount, fixture] of [
    [userA, idA, idB, accountIdB, ownA],
    [userB, idB, idA, accountIdA, ownB],
  ] as const) {
    const result = await client.from(table).update(spec.changeOwner(targetId, targetAccount))
      .eq("user_id", currentId).eq(spec.markerColumn, fixture.value).select("*");
    expectRlsDenial(result);
  }

  const crossUpdateValues = [markerFor("cross-update-a"), markerFor("cross-update-b")];
  const crossUpdates = await Promise.all([
    userA.from(table).update(spec.update(crossUpdateValues[0])).eq("user_id", idB)
      .eq(spec.markerColumn, ownB.value).select("*"),
    userB.from(table).update(spec.update(crossUpdateValues[1])).eq("user_id", idA)
      .eq(spec.markerColumn, ownA.value).select("*"),
  ]);
  crossUpdates.forEach(expectBlocked);

  const anonymousUpdateValues = [markerFor("anonymous-update-a"), markerFor("anonymous-update-b")];
  const anonymousUpdates = await Promise.all([
    anonymous.from(table).update(spec.update(anonymousUpdateValues[0])).eq("user_id", idA)
      .eq(spec.markerColumn, ownA.value).select("*"),
    anonymous.from(table).update(spec.update(anonymousUpdateValues[1])).eq("user_id", idB)
      .eq(spec.markerColumn, ownB.value).select("*"),
  ]);
  anonymousUpdates.forEach(expectBlocked);

  const crossDeletes = await Promise.all([
    userA.from(table).delete().eq("user_id", idB).eq(spec.markerColumn, ownB.value).select(spec.keyColumn),
    userB.from(table).delete().eq("user_id", idA).eq(spec.markerColumn, ownA.value).select(spec.keyColumn),
  ]);
  crossDeletes.forEach(expectBlocked);
  const anonymousDeletes = await Promise.all([
    anonymous.from(table).delete().eq("user_id", idA).eq(spec.markerColumn, ownA.value).select(spec.keyColumn),
    anonymous.from(table).delete().eq("user_id", idB).eq(spec.markerColumn, ownB.value).select(spec.keyColumn),
  ]);
  anonymousDeletes.forEach(expectBlocked);

  // Owner-side full-row reads prove that every denied attempt left both rows unchanged.
  const [unchangedA, unchangedB] = await Promise.all([
    readByMarker(userA, idA, ownA.value),
    readByMarker(userB, idB, ownB.value),
  ]);
  expect(unchangedA.error).toBeNull();
  expect(unchangedA.data).toEqual([ownA.row]);
  expect(unchangedB.error).toBeNull();
  expect(unchangedB.data).toEqual([ownB.row]);
  for (const attemptedValue of [...crossUpdateValues, ...anonymousUpdateValues]) {
    await assertNoMarkerInDatabase(attemptedValue);
  }

  for (const [client, userId, fixture, suffix] of [
    [userA, idA, ownA, "own-update-a"],
    [userB, idB, ownB, "own-update-b"],
  ] as const) {
    const updatedValue = markerFor(suffix);
    const updated = await client.from(table).update(spec.update(updatedValue))
      .eq("user_id", userId).eq(spec.markerColumn, fixture.value).select("*");
    expect(updated.error).toBeNull();
    expect(updated.data).toHaveLength(1);
    expect(updated.data?.[0].user_id).toBe(userId);
    expect(updated.data?.[0][spec.markerColumn]).toBe(updatedValue);

    const deleted = await client.from(table).delete().eq("user_id", userId)
      .eq(spec.markerColumn, updatedValue).select(spec.keyColumn);
    expect(deleted.error).toBeNull();
    expect(deleted.data).toHaveLength(1);
    const remaining = await readByMarker(client, userId, updatedValue);
    expect(remaining.error).toBeNull();
    expect(remaining.data).toEqual([]);
    await assertNoMarkerInDatabase(updatedValue);
  }
}

async function testPlaidItemsAreClientInaccessible(args: {
  userA: SupabaseClient;
  userB: SupabaseClient;
  anonymous: SupabaseClient;
  admin: SupabaseClient;
  idA: string;
  idB: string;
  marker: string;
  markerValues: Map<string, Set<string | number>>;
  createdFixtures: Array<{ table: string; keyColumn: string; key: string }>;
}) {
  const { userA, userB, anonymous, admin, idA, idB, marker, markerValues, createdFixtures } = args;
  const itemA = `${marker}:plaid-item:a`;
  const itemB = `${marker}:plaid-item:b`;
  const attemptedA = `${marker}:plaid-item:client-insert-a`;
  const attemptedB = `${marker}:plaid-item:client-insert-b`;
  const anonymousAttempt = `${marker}:plaid-item:anonymous`;
  const itemIds = [itemA, itemB, attemptedA, attemptedB, anonymousAttempt];
  itemIds.forEach((id) => rememberMarker(markerValues, "plaid_items", id));

  // Service-role use is limited to creating synthetic sentinel rows, independent verification,
  // and cleanup. The access-token values below are deliberately invalid placeholders.
  for (const [userId, plaid_item_id] of [[idA, itemA], [idB, itemB]] as const) {
    const result = await admin.from("plaid_items").insert({
      user_id: userId,
      plaid_item_id,
      access_token: "v1.synthetic-not-a-valid-token",
      institution_name: "Synthetic RLS Test Institution",
    }).select("id").single();
    expect(result.error).toBeNull();
    createdFixtures.push({ table: "plaid_items", keyColumn: "id", key: result.data!.id });
  }

  const readAttempts = await Promise.all([
    userA.from("plaid_items").select("id").eq("plaid_item_id", itemA),
    userA.from("plaid_items").select("id").eq("plaid_item_id", itemB),
    userB.from("plaid_items").select("id").eq("plaid_item_id", itemA),
    userB.from("plaid_items").select("id").eq("plaid_item_id", itemB),
    anonymous.from("plaid_items").select("id").in("plaid_item_id", [itemA, itemB]),
  ]);
  readAttempts.forEach(expectBlocked);

  const clientWrites = await Promise.all([
    userA.from("plaid_items").insert({
      user_id: idB, plaid_item_id: attemptedA, access_token: "v1.synthetic-not-a-valid-token",
    }).select("id"),
    userB.from("plaid_items").insert({
      user_id: idA, plaid_item_id: attemptedB, access_token: "v1.synthetic-not-a-valid-token",
    }).select("id"),
    anonymous.from("plaid_items").insert({
      user_id: idA, plaid_item_id: anonymousAttempt, access_token: "v1.synthetic-not-a-valid-token",
    }).select("id"),
  ]);
  clientWrites.forEach(expectBlocked);

  const updatesAndDeletes = await Promise.all([
    userA.from("plaid_items").update({ institution_name: "unexpected-client-update" }).eq("plaid_item_id", itemA).select("id"),
    userB.from("plaid_items").update({ institution_name: "unexpected-client-update" }).eq("plaid_item_id", itemB).select("id"),
    anonymous.from("plaid_items").update({ institution_name: "unexpected-anonymous-update" }).in("plaid_item_id", [itemA, itemB]).select("id"),
    userA.from("plaid_items").delete().eq("plaid_item_id", itemA).select("id"),
    userB.from("plaid_items").delete().eq("plaid_item_id", itemB).select("id"),
    anonymous.from("plaid_items").delete().in("plaid_item_id", [itemA, itemB]).select("id"),
  ]);
  updatesAndDeletes.forEach(expectBlocked);

  const { data, error } = await admin.from("plaid_items")
    .select("user_id,plaid_item_id,access_token,institution_name")
    .in("plaid_item_id", [itemA, itemB]);
  expect(error).toBeNull();
  expect(data).toHaveLength(2);
  expect(data?.map(({ user_id, plaid_item_id, access_token }) => ({ user_id, plaid_item_id, access_token })))
    .toEqual([
      { user_id: idA, plaid_item_id: itemA, access_token: "v1.synthetic-not-a-valid-token" },
      { user_id: idB, plaid_item_id: itemB, access_token: "v1.synthetic-not-a-valid-token" },
    ]);
  const inserted = await admin.from("plaid_items").select("id").in("plaid_item_id", [attemptedA, attemptedB, anonymousAttempt]);
  expect(inserted.error).toBeNull();
  expect(inserted.data).toEqual([]);
}

async function assertDedicatedUsersHaveNoFinancialData(admin: SupabaseClient, userIds: string[]) {
  const tables = [
    ["profiles", "id"],
    ["plaid_items", "user_id"],
    ["accounts", "user_id"],
    ["transactions", "user_id"],
    ["budgets", "user_id"],
    ["financial_goals", "user_id"],
    ["financial_settings", "user_id"],
    ["investment_holdings", "user_id"],
    ["investment_snapshots", "user_id"],
  ] as const;
  for (const [table, ownerColumn] of tables) {
    const { data, error } = await admin.from(table).select(ownerColumn).in(ownerColumn, userIds).limit(1);
    if (error) throw new Error(`Unable to verify the disposable-user precondition for ${table}.`);
    if (data?.length) {
      throw new Error(`Refusing to run RLS integration tests: designated users already have rows in ${table}.`);
    }
  }
}

async function cleanupSyntheticData(
  admin: SupabaseClient,
  userIds: string[],
  markerValues: Map<string, Set<string | number>>,
  createdFixtures: Array<{ table: string; keyColumn: string; key: string }>,
  profileRowsCreated: string[],
) {
  const cleanupOrder: FinancialTable[] = [
    "transactions",
    "investment_snapshots",
    "investment_holdings",
    "budgets",
    "financial_goals",
    "financial_settings",
    "accounts",
  ];
  const cleanupErrors: string[] = [];

  for (const table of cleanupOrder) {
    const spec = tableSpecs[table];
    const values = [...(markerValues.get(table) ?? [])];
    if (values.length === 0) continue;
    const query = admin.from(table).select(spec.keyColumn);
    const found = table === "financial_settings"
      ? await query.in("user_id", userIds).in(spec.markerColumn, values)
      : await query.in(spec.markerColumn, values);
    if (found.error) {
      cleanupErrors.push(`${table}: unable to find run fixtures`);
      continue;
    }
    const ids = (found.data ?? []).map((row) => (row as unknown as Record<string, unknown>)[spec.keyColumn]);
    if (ids.length > 0) {
      const { error } = await admin.from(table).delete().in(spec.keyColumn, ids);
      if (error) {
        cleanupErrors.push(`${table}: unable to delete run fixtures`);
        continue;
      }
    }
    const verify = table === "financial_settings"
      ? await admin.from(table).select(spec.keyColumn).in("user_id", userIds).in(spec.markerColumn, values)
      : await admin.from(table).select(spec.keyColumn).in(spec.markerColumn, values);
    if (verify.error || (verify.data?.length ?? 0) > 0) cleanupErrors.push(`${table}: run fixtures remain`);
  }

  const plaidValues = [...(markerValues.get("plaid_items") ?? [])];
  if (plaidValues.length > 0) {
    const plaidFound = await admin.from("plaid_items").select("id").in("plaid_item_id", plaidValues);
    if (plaidFound.error) cleanupErrors.push("plaid_items: unable to find run fixtures");
    else if ((plaidFound.data?.length ?? 0) > 0) {
      const ids = plaidFound.data!.map((row) => row.id);
      const { error } = await admin.from("plaid_items").delete().in("id", ids);
      if (error) cleanupErrors.push("plaid_items: unable to delete run fixtures");
      const verify = await admin.from("plaid_items").select("id").in("plaid_item_id", plaidValues);
      if (verify.error || (verify.data?.length ?? 0) > 0) cleanupErrors.push("plaid_items: run fixtures remain");
    }
  }

  // Profiles were verified absent before the test and inserted only by this run.
  // Delete only those exact test-user IDs, after dependent synthetic rows are removed.
  if (cleanupErrors.length === 0 && profileRowsCreated.length > 0) {
    const { error } = await admin.from("profiles").delete().in("id", profileRowsCreated);
    if (error) cleanupErrors.push("profiles: unable to delete run fixtures");
    const verify = await admin.from("profiles").select("id").in("id", profileRowsCreated);
    if (verify.error || (verify.data?.length ?? 0) > 0) cleanupErrors.push("profiles: run fixtures remain");
  } else if (cleanupErrors.length > 0 && profileRowsCreated.length > 0) {
    cleanupErrors.push("profiles: retained to avoid cascading while dependent cleanup is incomplete");
  }

  // Retain the tracked IDs in the failure message to make manual recovery specific.
  if (cleanupErrors.length > 0) {
    const tracked = createdFixtures.map(({ table, keyColumn, key }) => `${table}.${keyColumn}=${key}`).join(", ");
    throw new Error(`${cleanupErrors.join("; ")}. Tracked run fixtures: ${tracked || "none returned"}`);
  }
}

function assertSafeTarget(urlValue: string, expectedProjectRef?: string) {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error("RLS test target URL is invalid; no authentication or database request was made.");
  }

  const projectRef = url.hostname.split(".")[0];
  if (projectRef === blockedDevelopmentProjectRef) {
    throw new Error("RLS integration tests refuse the Dick-Newport development project; no request was made.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("RLS test target URL must not contain credentials or URL parameters.");
  }
  if (localSupabaseOrigins.has(url.origin) && url.pathname === "/") return;

  if (
    url.protocol === "https:"
    && expectedProjectRef === permittedHostedTestProjectRef
    && url.hostname === `${permittedHostedTestProjectRef}.supabase.co`
  ) {
    return;
  }
  throw new Error("Hosted RLS tests require the exact disposable project ref and matching Supabase URL; no request was made.");
}

function getConfigurationProblems() {
  const problems: string[] = [];
  if (process.env.DICK_NEWPORT_RLS_INTEGRATION !== "1") {
    problems.push("Set DICK_NEWPORT_RLS_INTEGRATION=1.");
  }
  if (process.env.DICK_NEWPORT_TEST_USERS_ARE_DISPOSABLE !== "yes") {
    problems.push("Set DICK_NEWPORT_TEST_USERS_ARE_DISPOSABLE=yes only for dedicated disposable users.");
  }

  const requiredValues: Array<[string, string | undefined]> = [
    ["NEXT_PUBLIC_SUPABASE_URL", config.url],
    ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", config.publishableKey],
    ["DICK_NEWPORT_RLS_TEST_ADMIN_KEY", config.adminKey],
    ["DICK_NEWPORT_RLS_USER_A_EMAIL", config.emailA],
    ["DICK_NEWPORT_RLS_USER_A_PASSWORD", config.passwordA],
    ["DICK_NEWPORT_RLS_USER_A_ID", config.idA],
    ["DICK_NEWPORT_RLS_USER_B_EMAIL", config.emailB],
    ["DICK_NEWPORT_RLS_USER_B_PASSWORD", config.passwordB],
    ["DICK_NEWPORT_RLS_USER_B_ID", config.idB],
  ];
  for (const [name, value] of requiredValues) {
    if (!value?.trim()) problems.push(`Provide ${name}.`);
  }

  if (config.url) {
    try {
      const url = new URL(config.url);
      const projectRef = url.hostname.split(".")[0];
      if (projectRef === blockedDevelopmentProjectRef) {
        problems.push("NEXT_PUBLIC_SUPABASE_URL targets the prohibited development project.");
      } else if (
        !localSupabaseOrigins.has(url.origin)
        && (
          url.protocol !== "https:"
          || config.expectedProjectRef !== permittedHostedTestProjectRef
          || url.hostname !== `${permittedHostedTestProjectRef}.supabase.co`
        )
      ) {
        problems.push(
          `For the hosted test project, set DICK_NEWPORT_RLS_EXPECTED_PROJECT_REF=${permittedHostedTestProjectRef} and use its matching Supabase URL.`,
        );
      }
      if (url.username || url.password || url.search || url.hash) {
        problems.push("NEXT_PUBLIC_SUPABASE_URL must not contain credentials or URL parameters.");
      }
    } catch {
      problems.push("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
    }
  }
  return problems;
}

function rememberMarker(map: Map<string, Set<string | number>>, table: string, value: string | number) {
  const values = map.get(table) ?? new Set<string | number>();
  values.add(value);
  map.set(table, values);
}

function expectBlocked(result: { data: unknown; error: { code?: string; status?: number } | null }) {
  if (result.error) {
    expect(isAccessDenied(result.error)).toBe(true);
    return;
  }
  expect(result.data ?? []).toEqual([]);
}

function expectRlsDenial(result: { data: unknown; error: { code?: string; status?: number } | null }) {
  expect(result.error ? isAccessDenied(result.error) : false).toBe(true);
}

function isAccessDenied(error: { code?: string; status?: number }) {
  return error.code === "42501" || error.status === 401 || error.status === 403;
}

async function signOutAll(clients: SupabaseClient[]) {
  const results = await Promise.all(clients.map((client) => client.auth.signOut()));
  if (results.some(({ error }) => error)) throw new Error("Unable to sign out every RLS integration client.");
}
