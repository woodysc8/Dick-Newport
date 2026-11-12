import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("preserves $420 and history, isolates rule/review owners, and durably locks/rate-limits private jobs", async () => {
  const db = await PGlite.create();
  const a = "00000000-0000-4000-8000-000000000001",
    b = "00000000-0000-4000-8000-000000000002",
    account = "00000000-0000-4000-8000-000000000003",
    tx = "00000000-0000-4000-8000-000000000004",
    otherTx = "00000000-0000-4000-8000-000000000005",
    token = "00000000-0000-4000-8000-000000000006";
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
      grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role;`);
    const dir = resolve("supabase/migrations"),
      next = "20261112020000_budget_briefing_jobs.sql";
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".sql") && n < next)
      .sort())
      await db.exec(readFileSync(resolve(dir, name), "utf8"));
    await db.query("insert into auth.users values($1),($2);", [a, b]);
    await db.query("insert into public.profiles(id) values($1),($2)", [a, b]);
    await db.query(
      "insert into public.user_weekly_budgets(user_id,weekly_limit) values($1,420)",
      [a],
    );
    await db.query(
      "insert into public.accounts(id,user_id,institution_name,account_name) values($1,$2,'Fixture','Checking')",
      [account, a],
    );
    await db.query(
      "insert into public.transactions(id,user_id,account_id,plaid_transaction_id,date,name,amount,pending,category_override,weekly_budget_override) values($1,$2,$3,'pending','2026-11-11','Fixture',12,true,'coffee','exclude')",
      [tx, a, account],
    );
    await db.query(
      "insert into public.transactions(id,user_id,date,name,amount) values($1,$2,'2026-11-11','Other owner',99)",
      [otherTx, b],
    );
    const ddl = readFileSync(resolve(dir, next), "utf8");
    await db.exec(ddl);
    await db.exec(ddl);
    expect(
      (await db.query("select weekly_limit from public.user_weekly_budgets"))
        .rows,
    ).toEqual([{ weekly_limit: "420.00" }]);
    expect(
      (
        await db.query(
          "select amount,category_override from public.transactions where id=$1",
          [tx],
        )
      ).rows,
    ).toEqual([{ amount: "12", category_override: "coffee" }]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    await db.exec("set role authenticated");
    await db.query(
      "insert into public.budget_category_rules(user_id,category,weekly_included,monthly_cap) values($1,'groceries',true,200)",
      [a],
    );
    await expect(
      db.query(
        "insert into public.budget_category_rules(user_id,category) values($1,'groceries')",
        [b],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query(
        "insert into public.user_monthly_budgets(user_id,monthly_limit) values($1,-1)",
        [a],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query(
        "insert into public.budget_category_rules(user_id,category) values($1,'bogus')",
        [a],
      ),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.query(
        "select public.review_budget_transactions($1,'groceries','include','exclude')",
        [[tx, otherTx]],
      ),
    ).rejects.toThrow();
    expect(
      (
        await db.query(
          "select category_override from public.transactions where id=$1",
          [tx],
        )
      ).rows,
    ).toEqual([{ category_override: "coffee" }]);
    expect(
      (
        await db.query(
          "select public.review_budget_transactions($1,'groceries','include','exclude') as saved",
          [[tx]],
        )
      ).rows,
    ).toEqual([{ saved: 1 }]);
    expect(
      (
        await db.query(
          "select entity from public.budget_audit order by created_at",
        )
      ).rows,
    ).toHaveLength(2);
    await db.query(
      "insert into public.transactions(user_id,account_id,plaid_transaction_id,pending_transaction_id,date,name,amount,pending) values($1,$2,'posted','pending','2026-11-11','Fixture',13,false)",
      [a, account],
    );
    expect(
      (
        await db.query(
          "select monthly_budget_override,weekly_budget_override,category_override from public.transactions where plaid_transaction_id='posted'",
        )
      ).rows,
    ).toEqual([
      {
        monthly_budget_override: "exclude",
        weekly_budget_override: "include",
        category_override: "groceries",
      },
    ]);
    const snapshot = (
      await db.query<{
        data: {
          user_id: string;
          transactions: unknown[];
          weekly_limit: number;
        };
      }>(
        "select public.financial_budget_snapshot('2026-10-01','2026-12-01') data",
      )
    ).rows[0].data;
    expect(snapshot.user_id).toBe(a);
    expect(snapshot.transactions).toHaveLength(2);
    expect(snapshot.weekly_limit).toBe(420);
    await expect(
      db.query(
        "select public.scheduled_financial_budget_snapshot($1,'2026-10-01','2026-12-01')",
        [b],
      ),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query("select public.claim_financial_job($1,'sync','key',$2)", [
        a,
        token,
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.query("select * from public.financial_job_runs"),
    ).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role; set role service_role");
    expect(
      (
        await db.query(
          "select public.claim_financial_job($1,'sync','one',$2) claimed",
          [a, token],
        )
      ).rows,
    ).toEqual([{ claimed: true }]);
    expect(
      (
        await db.query(
          "select public.claim_financial_job($1,'sync','two',$2) claimed",
          [a, token],
        )
      ).rows,
    ).toEqual([{ claimed: false }]);
    expect(
      (
        await db.query(
          "select public.finish_financial_job($1,'sync','one',$2,true,null) finished",
          [a, b],
        )
      ).rows,
    ).toEqual([{ finished: false }]);
    expect(
      (
        await db.query(
          "select public.finish_financial_job($1,'sync','one',$2,true,null) finished",
          [a, token],
        )
      ).rows,
    ).toEqual([{ finished: true }]);
    expect(
      (
        await db.query(
          "select public.claim_financial_job($1,'sync','one',$2) claimed",
          [a, token],
        )
      ).rows,
    ).toEqual([{ claimed: false }]);
    // Simulate elapsed time in this disposable DB, not in a live project.
    for (let i = 2; i <= 4; i++) {
      await db.exec(
        "update public.financial_job_status set last_attempt_at=now()-interval '4 hours'",
      );
      expect(
        (
          await db.query(
            "select public.claim_financial_job($1,'sync',$2,$3) claimed",
            [a, String(i), token],
          )
        ).rows,
      ).toEqual([{ claimed: true }]);
      await db.query(
        "select public.finish_financial_job($1,'sync',$2,$3,false,'UNAVAILABLE')",
        [a, String(i), token],
      );
    }
    await db.exec(
      "update public.financial_job_status set last_attempt_at=now()-interval '4 hours'",
    );
    expect(
      (
        await db.query(
          "select public.claim_financial_job($1,'sync','five',$2) claimed",
          [a, token],
        )
      ).rows,
    ).toEqual([{ claimed: false }]);
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
    await db.exec("set role authenticated");
    expect(
      (await db.query("select * from public.budget_category_rules")).rows,
    ).toEqual([]);
    expect((await db.query("select * from public.budget_audit")).rows).toEqual(
      [],
    );
    expect(
      (await db.query("select * from public.financial_job_status")).rows,
    ).toEqual([]);
    await db.exec("reset role; set role anon");
    await expect(
      db.query(
        "select public.financial_budget_snapshot('2026-10-01','2026-12-01')",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.close();
  }
}, 30000);
