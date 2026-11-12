import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";

it("atomically replaces only owner/Item-scoped returned positions, isolates accounts, and rolls back partial failures", async () => {
  const db = await PGlite.create();
  const owner = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002", credential = "00000000-0000-4000-8000-000000000003", connection = "00000000-0000-4000-8000-000000000004";
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'; grant usage on schema public,auth to anon,authenticated,service_role;");
    for (const name of readdirSync("supabase/migrations").filter((n) => n.endsWith(".sql")).sort()) await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
    await db.exec("grant all on all tables in schema public to service_role;"); // Supabase's existing service-role table grants.
    await db.query("insert into auth.users values ($1),($2);", [owner, other]);
    await db.query("insert into public.profiles(id) values ($1),($2)", [owner, other]);
    await db.query("insert into public.user_plaid_credentials(id,user_id,environment,encrypted_credentials) values ($1,$2,'sandbox','fixture')", [credential, owner]);
    await db.query("insert into public.plaid_items(id,user_id,credential_id,access_token,plaid_item_id,connection_status,products,institution_name,transactions_cursor) values ($1,$2,$3,'v1.fixture','item','active',array['transactions','investments'],'Fixture Brokerage','preserved-cursor')", [connection, owner, credential]);
    await db.query("insert into public.accounts(user_id,plaid_item_id,plaid_account_id,institution_name,account_name,account_type) values ($1,'item','returned','Fixture','Individual','investment'),($1,'item','omitted','Fixture','Roth IRA','investment'),($2,'foreign-item','foreign','Fixture','Other owner','investment')", [owner, other]);
    await db.query("insert into public.investment_holdings(user_id,plaid_item_id,plaid_account_id,security_id,quantity,institution_value) values ($1,'item','returned','old',1,80),($1,'item','omitted','retained',2,200),($2,'foreign-item','foreign','foreign-security',3,300)", [owner, other]);
    const account = { account_id: "returned", name: "Robinhood Individual", type: "investment", subtype: "brokerage", current_balance: 100, available_balance: null, currency: "USD" };
    const holding = { account_id: "returned", security_id: "new", security_name: "Fixture ETF", quantity: 2, institution_value: 100, institution_price: 50, cost_basis: 80, currency: "USD" };
    const call = (payload: unknown, user = owner) => db.query<{ result: { holdings: number } }>("select public.import_investment_holdings($1,$2,$3,$4) as result", [user, connection, credential, JSON.stringify(payload)]);
    await db.exec("set role service_role");
    const payload = { accounts: [account], holdings: [holding] };
    expect((await call(payload)).rows[0].result.holdings).toBe(1);
    await call(payload); // Same unique identity does not duplicate records.
    expect((await db.query("select security_id from public.investment_holdings order by security_id")).rows).toEqual([{ security_id: "foreign-security" }, { security_id: "new" }, { security_id: "retained" }]);
    expect((await db.query("select holdings_status from public.accounts where plaid_account_id='omitted'")).rows).toEqual([{ holdings_status: "not_returned" }]);
    await expect(call(payload, other)).rejects.toMatchObject({ code: "42501" });
    await expect(call({ accounts: [{ ...account, account_id: "foreign" }], holdings: [] })).rejects.toMatchObject({ code: "42501" });
    const before = (await db.query("select account_name,current_balance,holdings_status,holdings_synced_at from public.accounts where plaid_account_id='returned'")).rows;
    await expect(call({ accounts: [{ ...account, name: "MUST ROLL BACK", current_balance: 999 }], holdings: [{ ...holding, institution_value: "INVALID-NUMERIC" }] })).rejects.toMatchObject({ code: "22P02" });
    expect((await db.query("select account_name,current_balance,holdings_status,holdings_synced_at from public.accounts where plaid_account_id='returned'")).rows).toEqual(before);
    expect((await db.query("select institution_value from public.investment_holdings where security_id='new'")).rows).toEqual([{ institution_value: "100" }]);
    await expect(call({ accounts: [account], holdings: [holding, holding] })).rejects.toThrow();
    await expect(call({ accounts: [], holdings: [] })).rejects.toThrow();
    await call({ accounts: [account], holdings: [] });
    expect((await db.query("select security_id from public.investment_holdings order by security_id")).rows).toEqual([{ security_id: "foreign-security" }, { security_id: "retained" }]);
    expect((await db.query("select holdings_status from public.accounts where plaid_account_id='returned'")).rows).toEqual([{ holdings_status: "empty" }]);
    expect((await db.query("select transactions_cursor,access_token from public.plaid_items")).rows).toEqual([{ transactions_cursor: "preserved-cursor", access_token: "v1.fixture" }]);
    await db.exec("reset role; set role authenticated");
    await expect(call(payload)).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role; set role anon");
    await expect(call(payload)).rejects.toMatchObject({ code: "42501" });
  } finally { await db.close(); }
}, 30000);
