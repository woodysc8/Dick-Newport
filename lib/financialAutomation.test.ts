import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publishGoogleBriefing, googleBriefingConfig } from "./googleBriefing";
import {
  authorizedCron,
  scheduledSlots,
  withFinancialJob,
} from "./financialJobs";
import { financialBudget } from "./budgetEngine";
import {
  generateBriefing,
  briefingAmount,
  managedMarker,
  safeDescription,
} from "./financialBriefing";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { loadFinancialBudget } from "./financialBudgetData";

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
beforeEach(() => {
  vi.stubEnv("GOOGLE_BRIEFING_ENABLED", "true");
  vi.stubEnv("GOOGLE_BRIEFING_OWNER_USER_ID", "owner");
  vi.stubEnv("GOOGLE_BRIEFING_DOCUMENT_ID", "dedicated-document");
  vi.stubEnv("GOOGLE_BRIEFING_CLIENT_EMAIL", "writer@fixture.invalid");
  vi.stubEnv("GOOGLE_BRIEFING_OWNER_EMAIL", "owner@fixture.invalid");
  vi.stubEnv("GOOGLE_BRIEFING_PRIVATE_KEY", privateKey);
  vi.stubEnv("CRON_SECRET", "fixture-only-secret-at-least-32-characters");
  vi.stubEnv("FINANCIAL_SYNC_LOCAL_HOURS", "0,6,12,18");
});
afterEach(() => vi.unstubAllEnvs());
const privateFile = {
  mimeType: "application/vnd.google-apps.document",
  owners: [{ emailAddress: "owner@fixture.invalid" }],
  permissions: [
    { type: "user", emailAddress: "owner@fixture.invalid", role: "owner" },
    { type: "user", emailAddress: "writer@fixture.invalid", role: "writer" },
  ],
  capabilities: { canEdit: true },
};
const blankDoc = {
  revisionId: "revision",
  body: {
    content: [
      { startIndex: 0, endIndex: 1, sectionBreak: {} },
      {
        startIndex: 1,
        endIndex: 2,
        paragraph: { elements: [{ textRun: { content: "\n" } }] },
      },
    ],
  },
};
function provider(file: unknown = privateFile, doc: unknown = blankDoc) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ access_token: "fixture-ephemeral-token" }),
    )
    .mockResolvedValueOnce(Response.json(file))
    .mockResolvedValueOnce(Response.json(doc))
    .mockResolvedValueOnce(Response.json({}));
}
describe("private document publisher", () => {
  it("is disabled without opt-in and rejects another user's document use", async () => {
    expect(() => googleBriefingConfig("other")).toThrow("disabled");
    vi.stubEnv("GOOGLE_BRIEFING_ENABLED", "false");
    const fetcher = provider();
    await expect(
      publishGoogleBriefing("owner", managedMarker, { fetcher }),
    ).rejects.toThrow("disabled");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("updates only the fixed document with one atomic revision-guarded batch and minimal scope", async () => {
    const fetcher = provider();
    await publishGoogleBriefing("owner", `${managedMarker}\nBriefing\n`, {
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    const [url, init] = fetcher.mock.calls[3];
    expect(url).toBe(
      "https://docs.googleapis.com/v1/documents/dedicated-document:batchUpdate",
    );
    const body = JSON.parse(String(init?.body));
    expect(body.writeControl).toEqual({ requiredRevisionId: "revision" });
    expect(body.requests).toHaveLength(1);
    const assertion = new URLSearchParams(
      String(fetcher.mock.calls[0][1]?.body),
    ).get("assertion")!;
    const claims = JSON.parse(
      Buffer.from(assertion.split(".")[1], "base64url").toString(),
    );
    expect(claims.scope).toBe("https://www.googleapis.com/auth/drive.file");
    expect(
      fetcher.mock.calls.every(
        ([u]) => !String(u).includes("permissions.create"),
      ),
    ).toBe(true);
  });
  it.each([
    { ...privateFile, permissions: [{ type: "anyone" }] },
    {
      ...privateFile,
      permissions: [{ type: "domain", emailAddress: "fixture.invalid" }],
    },
    {
      ...privateFile,
      permissions: [{ type: "user", emailAddress: "stranger@fixture.invalid" }],
    },
    { ...privateFile, owners: [] },
    { ...privateFile, capabilities: { canEdit: false } },
  ])("refuses nonprivate or unauthorized document access", async (file) => {
    const fetcher = provider(file);
    await expect(
      publishGoogleBriefing("owner", managedMarker, { fetcher }),
    ).rejects.toThrow("did not complete");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not replace an unrelated existing document", async () => {
    const fetcher = provider(privateFile, {
      ...blankDoc,
      body: {
        content: [
          {
            endIndex: 99,
            paragraph: {
              elements: [
                { textRun: { content: "Personal unrelated notes\n" } },
              ],
            },
          },
        ],
      },
    });
    await expect(
      publishGoogleBriefing("owner", managedMarker, { fetcher }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("skips an identical document without a write", async () => {
    const text = `${managedMarker}\n`;
    const fetcher = provider(privateFile, {
      ...blankDoc,
      body: {
        content: [
          {
            endIndex: text.length + 1,
            paragraph: { elements: [{ textRun: { content: text } }] },
          },
        ],
      },
    });
    await expect(
      publishGoogleBriefing("owner", text, { fetcher }),
    ).resolves.toMatchObject({ unchanged: true });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("bounded retries handle throttling without exposing provider responses", async () => {
    const wait = vi.fn().mockResolvedValue(undefined),
      fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("sensitive provider body", { status: 429 }),
        );
    await expect(
      publishGoogleBriefing("owner", managedMarker, { fetcher, wait }),
    ).rejects.toThrow("did not complete");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });
  it("rejects revision conflicts and never marks them successful", async () => {
    const fetcher = provider();
    fetcher
      .mockReset()
      .mockResolvedValueOnce(Response.json({ access_token: "fixture-token" }))
      .mockResolvedValueOnce(Response.json(privateFile))
      .mockResolvedValueOnce(Response.json(blankDoc))
      .mockResolvedValueOnce(new Response("secret", { status: 400 }));
    await expect(
      publishGoogleBriefing("owner", managedMarker, { fetcher }),
    ).rejects.toThrow("preview changed");
  });
  it("rejects oversize input and malformed key safely without HTTP calls", async () => {
    const fetcher = provider();
    await expect(
      publishGoogleBriefing("owner", managedMarker + "x".repeat(30000), {
        fetcher,
      }),
    ).rejects.toThrow("disabled");
    vi.stubEnv("GOOGLE_BRIEFING_PRIVATE_KEY", "malformed fixture");
    await expect(
      publishGoogleBriefing("owner", managedMarker, { fetcher }),
    ).rejects.toThrow("disabled");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe("scheduler and durable job guards", () => {
  it("requires the exact bearer secret, without a URL-secret fallback", () => {
    const req = (header?: string) =>
      new Request("https://fixture.invalid/api/cron/financial?secret=ignored", {
        headers: header ? { authorization: header } : {},
      });
    expect(authorizedCron(req())).toBe(false);
    expect(authorizedCron(req("Bearer wrong"))).toBe(false);
    expect(authorizedCron(req(`Bearer ${process.env.CRON_SECRET}`))).toBe(true);
    vi.stubEnv("CRON_SECRET", "short");
    expect(authorizedCron(req("Bearer short"))).toBe(false);
  });
  it.each([
    ["2026-03-07T11:30:00Z", "2026-03-07:briefing"],
    ["2026-03-08T10:30:00Z", "2026-03-08:briefing"],
    ["2026-11-01T11:30:00Z", "2026-11-01:briefing"],
  ])("handles DST for the pre-7AM window %s", (date, expected) =>
    expect(scheduledSlots(new Date(date)).briefing).toBe(expected),
  );
  it("has four distributed local sync slots and skips outside the window", () => {
    for (const hour of [5, 11, 17, 23])
      expect(
        scheduledSlots(
          new Date(`2026-11-11T${hour.toString().padStart(2, "0")}:00:00Z`),
        ).sync,
      ).toBeTruthy();
    expect(scheduledSlots(new Date("2026-11-11T12:00:00Z"))).toMatchObject({
      sync: null,
      briefing: null,
    });
    vi.stubEnv("FINANCIAL_SYNC_LOCAL_HOURS", "6,6,6,6");
    expect(() => scheduledSlots()).toThrow("disabled");
  });
  it("does not execute an unclaimed/duplicate job", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false }),
      work = vi.fn();
    await expect(
      withFinancialJob(
        { rpc } as unknown as SupabaseClient,
        "owner",
        "sync",
        "key",
        work,
      ),
    ).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });
  it("finishes success only after work and releases failure with a sanitized category", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true });
    await expect(
      withFinancialJob(
        { rpc } as unknown as SupabaseClient,
        "owner",
        "sync",
        "key",
        async () => {
          throw new Error("sensitive raw provider details");
        },
      ),
    ).rejects.toThrow("tracking is unavailable");
    expect(rpc.mock.calls[1][1]).toMatchObject({
      owner_id: "owner",
      succeeded: false,
      error_category: "UNAVAILABLE",
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("sensitive");
  });
});
describe("deterministic briefing", () => {
  it("renders bounded private totals, honest freshness and no infrastructure or account identifiers", () => {
    const now = new Date("2026-11-11T17:00:00Z");
    const data = {
      ...financialBudget([], [], 420, undefined, now),
      policy: { categories: [], accounts: [], monthly_limit: null },
      snapshot: {
        user_id: "private-user-id",
        transactions: [],
        accounts: [],
        weekly_limit: 420,
        monthly_limit: null,
        category_rules: [],
        account_rules: [],
        jobs: [],
        sync_in_progress: false,
      },
      stale: true,
      lastSync: null,
      planning: null,
      briefingDetails: null,
    } as Awaited<ReturnType<typeof loadFinancialBudget>>;
    const result = generateBriefing(data, now);
    expect(result).toEqual(generateBriefing(data, now));
    expect(result.text).toContain("$420.00");
    expect(result.text).toContain("PROVISIONAL");
    expect(result.text).toContain("STALE/UNVERIFIED");
    expect(result.text).not.toContain("private-user-id");
    expect(result.text.length).toBeLessThan(30000);
    for (const amount of [null, "", "invalid"])
      expect(briefingAmount(amount, "USD")).toBe("Amount unavailable");
    expect(briefingAmount(-5, "USD")).toBe("+$5.00 credit");
    expect(briefingAmount(5, "EUR")).toBe("Unsupported/unknown currency");
    expect(safeDescription("Payment ACCT123456789")).toBe("Payment ACCT[redacted]");
    expect(safeDescription("Purchase 123456789\nname")).toBe(
      "Purchase [redacted] name",
    );
  });
});
