import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
it("isolates reports and preferences, blocks public access/edits, and deduplicates scheduled snapshots", async () => {
  const db = await PGlite.create();
  const a = "00000000-0000-4000-8000-000000000001", b = "00000000-0000-4000-8000-000000000002";
  const report = JSON.stringify({ version: 1, generatedAt: "2026-11-12T15:00:00Z", sections: [{ title: "Frozen", lines: ["Known at generation time"] }] });
  try {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid'; grant usage on schema public,auth to anon,authenticated,service_role;");
    await db.exec(readFileSync("supabase/migrations/20261112200000_financial_reports.sql", "utf8"));
    await db.query("insert into auth.users values ($1),($2)", [a, b]);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [a]);
    await db.exec("set role authenticated");
    const insert = "insert into public.financial_report_snapshots(user_id,generated_at,report,schedule_key) values ($1,'2026-11-12T15:00:00Z',$2,$3)";
    await db.query(insert, [a, report, null]);
    await expect(db.query(insert, [b, report, null])).rejects.toMatchObject({ code: "42501" });
    await expect(db.query(insert, [a, report, "weekly:2026-11-09"])).rejects.toMatchObject({ code: "42501" });
    await expect(db.exec("update public.financial_report_snapshots set report='{}'")).rejects.toMatchObject({ code: "42501" });
    await expect(db.exec("delete from public.financial_report_snapshots")).rejects.toMatchObject({ code: "42501" });
    await db.query("insert into public.financial_report_preferences(user_id,weekly) values ($1,true)", [a]);
    await expect(db.query("insert into public.financial_report_preferences(user_id) values ($1)", [b])).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [b]);
    await db.exec("set role authenticated");
    expect((await db.query("select * from public.financial_report_snapshots")).rows).toEqual([]);
    expect((await db.query("select * from public.financial_report_preferences")).rows).toEqual([]);
    expect((await db.exec("update public.financial_report_preferences set weekly=false"))[0].affectedRows).toBe(0);
    await db.exec("reset role; set role anon");
    await expect(db.query("select * from public.financial_report_snapshots")).rejects.toMatchObject({ code: "42501" });
    await expect(db.query("select * from public.financial_report_preferences")).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role; set role service_role");
    await db.query(insert, [a, report, "weekly:2026-11-09"]);
    await expect(db.query(insert, [a, report, "weekly:2026-11-09"])).rejects.toMatchObject({ code: "23505" });
    await db.exec("reset role"); // Trigger also protects a privileged update.
    await expect(db.exec("update public.financial_report_snapshots set generated_at=now()")).rejects.toMatchObject({ code: "42501" });
    const saved = await db.query<{ report: unknown }>("select report from public.financial_report_snapshots");
    expect(saved.rows).toHaveLength(2); expect(saved.rows.every((row) => JSON.stringify(row.report).includes("Known at generation time"))).toBe(true);
  } finally { await db.close(); }
}, 30000);
