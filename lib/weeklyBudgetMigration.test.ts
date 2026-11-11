import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("replays additive DDL, isolates owners, constrains settings, and preserves edits through posting/sync", async () => {
  const db = await PGlite.create();
  const a = "00000000-0000-4000-8000-000000000001",
    b = "00000000-0000-4000-8000-000000000002",
    accountA = "00000000-0000-4000-8000-000000000003",
    accountB = "00000000-0000-4000-8000-000000000004";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`);
    const dir = resolve("supabase/migrations"),
      names = readdirSync(dir)
        .filter((n) => n.endsWith(".sql"))
        .sort();
    for (const name of names)
      await db.exec(readFileSync(resolve(dir, name), "utf8"));
    await db.query("insert into auth.users values ($1),($2)", [a, b]);
    await db.query(
      'insert into public.profiles(id,financial_profile) values ($1,\'{"budget":{"monthlyLimit":1234}}\'),($2,null)',
      [a, b],
    );
    await db.query(
      "insert into public.accounts(id,user_id,institution_name,account_name) values ($1,$2,'Test','A'),($3,$4,'Test','B')",
      [accountA, a, accountB, b],
    );
    await db.query(
      "insert into public.transactions(user_id,account_id,plaid_transaction_id,date,name,amount,pending,category_override,weekly_budget_override) values ($1,$2,'pending','2026-11-10','Test',10,true,'coffee','exclude')",
      [a, accountA],
    );
    await db.query(
      "insert into public.transactions(user_id,account_id,plaid_transaction_id,pending_transaction_id,date,name,amount,pending,plaid_primary_category,normalized_category) values ($1,$2,'posted','pending','2026-11-11','Test',12,false,'FOOD_AND_DRINK','dining')",
      [a, accountA],
    );
    expect(
      (
        await db.query(
          "select category_override,weekly_budget_override from public.transactions where plaid_transaction_id='posted'",
        )
      ).rows,
    ).toEqual([
      { category_override: "coffee", weekly_budget_override: "exclude" },
    ]);
    await db.exec(
      "update public.transactions set amount=13,normalized_category='shopping' where plaid_transaction_id='posted'; delete from public.transactions where plaid_transaction_id='pending'",
    );
    expect(
      (
        await db.query(
          "select category_override,weekly_budget_override,plaid_primary_category from public.transactions",
        )
      ).rows,
    ).toEqual([
      {
        category_override: "coffee",
        weekly_budget_override: "exclude",
        plaid_primary_category: "FOOD_AND_DRINK",
      },
    ]);
    // Reapplying the new migration is idempotent and does not rewrite financial records.
    await db.exec(
      readFileSync(
        resolve(dir, "20261112010000_transactions_weekly_budget.sql"),
        "utf8",
      ),
    );
    expect(
      (await db.query("select amount from public.transactions")).rows,
    ).toEqual([{ amount: "13" }]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    await db.exec("set role authenticated");
    await db.query(
      "insert into public.user_weekly_budgets(user_id,weekly_limit) values ($1,100)",
      [a],
    );
    const snapshot = (
      await db.query<{
        snapshot: {
          user_id: string;
          transactions: Array<{ amount: number }>;
          accounts: Array<{ id: string }>;
          weekly_limit: number;
        };
      }>(
        "select public.weekly_budget_snapshot('2026-11-02','2026-11-16') as snapshot",
      )
    ).rows[0].snapshot;
    expect(snapshot.user_id).toBe(a);
    expect(snapshot.transactions.map((t) => t.amount)).toEqual([13]);
    expect(snapshot.accounts.map((account) => account.id)).toEqual([accountA]);
    expect(snapshot.weekly_limit).toBe(100);
    await expect(
      db.query(
        "insert into public.user_weekly_budgets(user_id,weekly_limit) values ($1,100)",
        [b],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query(
        "update public.user_weekly_budgets set weekly_limit=-1 where user_id=$1",
        [a],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query(
        "update public.user_weekly_budgets set timezone='UTC' where user_id=$1",
        [a],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query(
        "update public.accounts set weekly_budget_source='anything' where id=$1",
        [accountA],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (
        await db.query(
          "update public.accounts set weekly_budget_source='include' where id=$1 returning id",
          [accountB],
        )
      ).rows,
    ).toEqual([]);
    await expect(
      db.query(
        "insert into public.transactions(user_id,account_id,date,name,amount) values ($1,$2,'2026-11-11','Wrong owner',1)",
        [a, accountB],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await db.query(
      "update public.user_weekly_budgets set weekly_limit=null where user_id=$1",
      [a],
    );
    expect(
      (await db.query("select weekly_limit from public.user_weekly_budgets"))
        .rows,
    ).toEqual([{ weekly_limit: null }]);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
    await db.exec("set role authenticated");
    const otherSnapshot = (
      await db.query<{
        snapshot: { transactions: unknown[]; accounts: Array<{ id: string }> };
      }>(
        "select public.weekly_budget_snapshot('2026-11-02','2026-11-16') as snapshot",
      )
    ).rows[0].snapshot;
    expect(otherSnapshot.transactions).toEqual([]);
    expect(otherSnapshot.accounts.map((account) => account.id)).toEqual([
      accountB,
    ]);
    expect(
      (await db.query("select * from public.user_weekly_budgets")).rows,
    ).toEqual([]);
    expect((await db.query("select * from public.transactions")).rows).toEqual(
      [],
    );
    await db.exec("reset role; set role anon");
    await expect(
      db.query(
        "select public.weekly_budget_snapshot('2026-11-02','2026-11-16')",
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query("select * from public.user_weekly_budgets"),
    ).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role");
    expect(
      (
        await db.query(
          "select financial_profile from public.profiles where id=$1",
          [a],
        )
      ).rows,
    ).toEqual([{ financial_profile: { budget: { monthlyLimit: 1234 } } }]);
  } finally {
    await db.close();
  }
}, 30000);
