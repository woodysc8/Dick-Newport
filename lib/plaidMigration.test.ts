import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("personal Plaid migration on isolated Postgres", () => {
  it("replays migration history, protects credentials, and enforces Item ownership without losing history", async () => {
    const db = await PGlite.create();
    const userA = "00000000-0000-4000-8000-000000000001";
    const userB = "00000000-0000-4000-8000-000000000002";
    const credentialA = "00000000-0000-4000-8000-000000000003";
    const credentialB = "00000000-0000-4000-8000-000000000004";
    try {
      // Supabase's Auth schema and standard API roles; all app migrations run verbatim.
      await db.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        create schema auth;
        create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as
          'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
        grant usage on schema public, auth to anon, authenticated, service_role;
        grant execute on function auth.uid() to anon, authenticated, service_role;
      `);
      const migrations = resolve("supabase/migrations");
      const names = readdirSync(migrations).filter(name => name.endsWith(".sql")).sort();
      for (const name of names.filter(name => !name.includes("personal_plaid_credentials"))) {
        await db.exec(readFileSync(resolve(migrations, name), "utf8"));
      }
      await db.query("insert into auth.users(id) values ($1), ($2)", [userA, userB]);
      await db.query("insert into public.profiles(id) values ($1), ($2)", [userA, userB]);
      await db.query("insert into public.plaid_items(user_id, plaid_item_id, access_token) values ($1, 'legacy-item', 'synthetic-legacy-token')", [userA]);
      await db.query("insert into public.accounts(user_id, institution_name, account_name, plaid_item_id, current_balance) values ($1, 'Test', 'Historical', 'legacy-item', null)", [userA]);
      await db.exec(readFileSync(resolve(migrations, names.find(name => name.includes("personal_plaid_credentials"))!), "utf8"));
      expect((await db.query("select connection_status, credential_id from public.plaid_items where plaid_item_id = 'legacy-item'")).rows)
        .toEqual([{ connection_status: "reconnect_required", credential_id: null }]);
      expect((await db.query("select account_name, current_balance from public.accounts")).rows).toEqual([{ account_name: "Historical", current_balance: null }]);

      // The service role must be explicitly permitted to use the new schema objects.
      await db.exec("set role service_role");
      await db.query("insert into public.user_plaid_credentials(id,user_id,environment,encrypted_credentials) values ($1,$2,'sandbox','synthetic-ciphertext'), ($3,$4,'production','synthetic-ciphertext')", [credentialA, userA, credentialB, userB]);
      expect((await db.query("select public.acquire_personal_plaid_operation($1,$2) as acquired", [userA, credentialA])).rows).toEqual([{ acquired: true }]);
      expect((await db.query("select public.acquire_personal_plaid_operation($1,$2) as acquired", [userA, credentialB])).rows).toEqual([{ acquired: false }]);
      await db.exec("reset role");

      await expect(db.query("insert into public.plaid_items(user_id,plaid_item_id,access_token,credential_id,connection_status) values ($1,'cross-user','v1.synthetic-ciphertext',$2,'active')", [userB, credentialA]))
        .rejects.toMatchObject({ code: "23503" });
      await expect(db.query("insert into public.plaid_items(user_id,plaid_item_id,access_token,connection_status) values ($1,'missing-credentials','synthetic-token','active')", [userA]))
        .rejects.toMatchObject({ code: "23514" });
      await db.query("insert into public.plaid_items(user_id,plaid_item_id,access_token,credential_id,connection_status) values ($1,'personal-item','v1.synthetic-ciphertext',$2,'active')", [userA, credentialA]);
      await expect(db.query("delete from public.user_plaid_credentials where id=$1", [credentialA])).rejects.toMatchObject({ code: "23001" });

      for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role}`);
        await expect(db.query("select encrypted_credentials from public.user_plaid_credentials")).rejects.toMatchObject({ code: "42501" });
        await expect(db.query("select access_token from public.plaid_items")).rejects.toMatchObject({ code: "42501" });
        await expect(db.query("delete from public.user_plaid_credentials")).rejects.toMatchObject({ code: "42501" });
        await expect(db.query("select public.acquire_personal_plaid_operation($1,$2)", [userA, credentialB])).rejects.toMatchObject({ code: "42501" });
        await db.exec("reset role");
      }
      await db.query("insert into public.investment_snapshots(user_id,plaid_item_id,plaid_account_id,snapshot_date,portfolio_value) values ($1,'personal-item','test-account','2026-11-11',null)", [userA]);
      expect((await db.query("select portfolio_value from public.investment_snapshots")).rows).toEqual([{ portfolio_value: null }]);
      const rls = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid='public.user_plaid_credentials'::regclass");
      expect(rls.rows[0].relrowsecurity).toBe(true);
    } finally { await db.close(); }
  }, 30000);
});
