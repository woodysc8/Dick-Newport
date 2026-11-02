import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({
  getAuthenticatedSupabaseContext: vi.fn(),
  ensureOwnProfile: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
  ownerFilter: vi.fn(),
}));

vi.mock("../../lib/supabase/server", () => ({
  getAuthenticatedSupabaseContext: mocks.getAuthenticatedSupabaseContext,
  ensureOwnProfile: mocks.ensureOwnProfile,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { saveFinancialProfile } from "./actions";

function persistentProfileClient(seed: Record<string, unknown>, options: { synchronizeFirstTwoReads?: boolean } = {}) {
  const rows = new Map(Object.entries(seed));
  const readIds: string[] = [];
  const writeIds: string[] = [];
  let readCount = 0;
  let releaseReads!: () => void;
  const readsReady = new Promise<void>((resolve) => { releaseReads = resolve; });
  const rawClient = {
    from: vi.fn((table: string) => {
      if (table !== "profiles") throw new Error("Unexpected table in profile persistence test.");
      return {
        select: vi.fn(() => ({
          eq: vi.fn((column: string, ownerId: string) => {
            readIds.push(ownerId);
            return {
              maybeSingle: vi.fn().mockImplementation(async () => {
                const snapshot = rows.get(ownerId);
                if (options.synchronizeFirstTwoReads && readCount < 2) {
                  readCount += 1;
                  if (readCount === 2) releaseReads();
                  await readsReady;
                }
                return {
                  data: column === "id" && rows.has(ownerId) ? { financial_profile: snapshot } : null,
                  error: null,
                };
              }),
            };
          }),
        })),
        update: vi.fn((values: { financial_profile: unknown }) => {
          const filters = new Map<string, { operator: "eq" | "is"; value: unknown }>();
          const query = {
            eq: vi.fn((column: string, value: unknown) => {
              filters.set(column, { operator: "eq", value });
              if (column === "id") writeIds.push(String(value));
              return query;
            }),
            is: vi.fn((column: string, value: unknown) => {
              filters.set(column, { operator: "is", value });
              return query;
            }),
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockImplementation(async () => {
                const ownerId = String(filters.get("id")?.value);
                if (!rows.has(ownerId)) return { data: null, error: null };
                const expected = filters.get("financial_profile");
                const actual = rows.get(ownerId);
                const matches = expected?.operator === "is"
                  ? actual == null && expected.value === null
                  : expected?.operator === "eq" && JSON.stringify(actual) === JSON.stringify(JSON.parse(String(expected.value)));
                if (!matches) return { data: null, error: null };
                rows.set(ownerId, values.financial_profile);
                return { data: { id: ownerId }, error: null };
              }),
            })),
          };
          return query;
        }),
      };
    }),
  };
  const supabase = rawClient as unknown as SupabaseClient;
  return {
    supabase,
    rows,
    readIds,
    writeIds,
    reload: async (ownerId: string) => {
      const { data } = await supabase.from("profiles").select("financial_profile").eq("id", ownerId).maybeSingle();
      return data?.financial_profile as Record<string, unknown>;
    },
  };
}

function collectionForm(values: Record<string, unknown>): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) form.set(key, JSON.stringify(value));
  return form;
}

async function saveAs(ownerId: string, supabase: unknown, form: FormData) {
  mocks.getAuthenticatedSupabaseContext.mockResolvedValue({ user: { id: ownerId }, supabase });
  await expect(saveFinancialProfile({ errors: {} }, form)).rejects.toThrow("redirect:/");
}

function client(financialProfile: unknown = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: { financial_profile: financialProfile }, error: null });
  const select = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) });
  const versionFilter = { select: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { id: "user-real" }, error: null }) }) };
  const profileWriteEq = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue(versionFilter), is: vi.fn().mockReturnValue(versionFilter) });
  const update = vi.fn().mockReturnValue({ eq: profileWriteEq });
  const from = vi.fn((table: string) => table === "profiles" ? { select, update } : {});
  return { supabase: { from }, profileWriteEq, update };
}

describe("save financial profile server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((path: string) => { throw new Error(`redirect:${path}`); });
  });

  it("requires a verified user and writes using that user's id, ignoring any submitted owner id", async () => {
    const { supabase, profileWriteEq } = client();
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue({ user: { id: "user-real" }, supabase });
    const form = new FormData();
    form.set("user_id", "attacker-selected-id");
    await expect(saveFinancialProfile({ errors: {} }, form)).rejects.toThrow("redirect:/");
    expect(mocks.ensureOwnProfile).toHaveBeenCalledWith(supabase, "user-real");
    expect(profileWriteEq).toHaveBeenCalledWith("id", "user-real");
  });

  it("redirects unauthenticated calls to sign-in without touching profile data", async () => {
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue(null);
    await expect(saveFinancialProfile({ errors: {} }, new FormData())).rejects.toThrow("redirect:/login");
    expect(mocks.ensureOwnProfile).not.toHaveBeenCalled();
  });

  it("does not persist an invalid intake", async () => {
    const { supabase, update } = client();
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue({ user: { id: "user-real" }, supabase });
    const form = new FormData();
    form.set("incomeAmount", "2500");
    const result = await saveFinancialProfile({ errors: {} }, form);
    expect(result.errors.incomeBasis).toBeDefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("persists collection edits under the authenticated owner and preserves legacy dashboard fields", async () => {
    const legacy = {
      label: "Example", currency: "USD",
      income: { amount: 4200, basis: "gross", frequency: "monthly" },
      paychecks: { netAmount: 3000, frequency: "monthly", rothContribution: 100 },
      retirementContributions: { perPaycheck: 100, destination: "Example work plan" },
      budget: { monthlyIncome: 3000, monthlySpendingTarget: 2200, expenses: [] },
    };
    const { supabase, update, profileWriteEq } = client(legacy);
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue({ user: { id: "owner-user" }, supabase });
    const form = new FormData();
    form.set("incomeSources", JSON.stringify([
      { name: "Salary", type: "employment", amount: 5000, basis: "gross", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: false },
      { name: "Take-home salary", type: "employment", amount: 3500, basis: "net", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true },
    ]));
    form.set("financialAccounts", "[]");
    form.set("retirementContributionPlans", JSON.stringify([{ name: "Work plan", contribution: { basis: "amount", amount: 250, frequency: "monthly" }, employerMatch: { percentage: 50, basis: "employee-contribution" } }]));
    form.set("debts", "[]");
    form.set("recurringExpenses", "[]");
    form.set("savingsAllocations", "[]");
    form.set("goals", "[]");

    await expect(saveFinancialProfile({ errors: {} }, form)).rejects.toThrow("redirect:/");
    expect(profileWriteEq).toHaveBeenCalledWith("id", "owner-user");
    expect(update).toHaveBeenCalledTimes(1);
    const saved = update.mock.calls[0][0].financial_profile;
    expect(saved.incomeSources).toHaveLength(2);
    expect(saved.incomeSources[0].includeInBudgetEstimate).toBe(false);
    expect(saved.retirementContributionPlans[0].employerMatch.percentage).toBe(50);
    expect(saved.income).toEqual(legacy.income);
    expect(saved.paychecks).toEqual(legacy.paychecks);
    expect(saved.retirementContributions).toEqual(legacy.retirementContributions);
    expect(saved.budget).toEqual(legacy.budget);
  });

  it("round-trips every flexible collection through the mocked profile storage boundary", async () => {
    const { supabase, readIds, writeIds, reload } = persistentProfileClient({
      "owner-a": { label: "Owner A", currency: "USD", paychecks: { netAmount: 0, frequency: "monthly" } },
    });
    const form = collectionForm({
      incomeSources: [
        { name: "Fictional salary", type: "employment", amount: 0, basis: "net", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true },
        { name: "Unknown benefit", type: "benefit" },
      ],
      financialAccounts: [
        { name: "Fictional checking", accountType: "depository", balance: 0, balanceSource: "manual" },
        { name: "Unknown savings", accountType: "depository", subtype: "savings", balanceSource: "unknown" },
      ],
      retirementContributionPlans: [
        { name: "Fictional plan", contribution: { basis: "amount", amount: 0, frequency: "monthly" } },
        { name: "Unknown plan", contribution: { basis: "percentage", percentageOf: "unknown" } },
      ],
      debts: [{ name: "Fictional card", balance: 0, monthlyPayment: 0 }, { name: "Unknown loan" }],
      recurringExpenses: [{ name: "Fictional bill", amount: 0, frequency: "monthly" }, { name: "Unknown annual bill", frequency: "annual" }],
      savingsAllocations: [{ name: "Fictional reserve", amount: 0, frequency: "monthly" }, { name: "Unknown reserve", frequency: "annual" }],
      goals: [{ name: "Fictional goal", targetAmount: 0 }, { name: "Unknown goal", targetDate: "2028-01-01" }],
    });

    await saveAs("owner-a", supabase, form);
    const reloaded = await reload("owner-a");
    expect(readIds).toEqual(["owner-a", "owner-a"]);
    expect(writeIds).toEqual(["owner-a"]);
    expect(reloaded.incomeSources).toEqual([
      { name: "Fictional salary", type: "employment", amount: 0, basis: "net", frequency: "monthly", regularity: "regular", includeInBudgetEstimate: true },
      { name: "Unknown benefit", type: "benefit" },
    ]);
    expect(reloaded.financialAccounts).toEqual([
      { name: "Fictional checking", accountType: "depository", balance: 0, balanceSource: "manual" },
      { name: "Unknown savings", accountType: "depository", subtype: "savings", balanceSource: "unknown" },
    ]);
    expect(reloaded.retirementContributionPlans).toEqual([
      { name: "Fictional plan", contribution: { basis: "amount", amount: 0, frequency: "monthly" } },
      { name: "Unknown plan", contribution: { basis: "percentage", percentageOf: "unknown" } },
    ]);
    expect(reloaded.debts).toEqual([{ name: "Fictional card", balance: 0, monthlyPayment: 0 }, { name: "Unknown loan" }]);
    expect(reloaded.recurringExpenses).toEqual([{ name: "Fictional bill", amount: 0, frequency: "monthly" }, { name: "Unknown annual bill", frequency: "annual" }]);
    expect(reloaded.savingsAllocations).toEqual([{ name: "Fictional reserve", amount: 0, frequency: "monthly" }, { name: "Unknown reserve", frequency: "annual" }]);
    expect(reloaded.goals).toEqual([{ name: "Fictional goal", targetAmount: 0 }, { name: "Unknown goal", targetDate: "2028-01-01" }]);
    for (const key of ["incomeSources", "financialAccounts", "retirementContributionPlans", "debts", "recurringExpenses", "savingsAllocations", "goals"]) {
      expect((reloaded[key] as Array<Record<string, unknown>>).every((record) => !Object.hasOwn(record, "id"))).toBe(true);
    }
  });

  it("round-trips a legacy-only profile without inventing flexible collections", async () => {
    const legacyOnly = {
      label: "Fictional legacy profile", currency: "USD",
      income: { amount: 4200, basis: "gross", frequency: "monthly" },
      paychecks: { netAmount: 3100, frequency: "monthly", rothContribution: 100 },
      retirementContributions: { perPaycheck: 100, destination: "Fictional work plan" },
      budget: { monthlyIncome: 3100, monthlySpendingTarget: 2200, expenses: [] },
    };
    const { supabase, reload } = persistentProfileClient({ "owner-a": legacyOnly });

    await saveAs("owner-a", supabase, new FormData());

    const reloaded = await reload("owner-a");
    expect(reloaded).toMatchObject(legacyOnly);
    expect(reloaded).toHaveProperty("onboardingCompletedAt");
    expect(reloaded).toHaveProperty("retirementContributionPlans", [
      {
        name: "Legacy retirement contribution preference",
        destinationAccountName: "Fictional work plan",
        contribution: { basis: "amount", amount: 100, frequency: "monthly" },
      },
    ]);
  });

  it("preserves omitted collections and persists explicit clearing as an empty collection", async () => {
    const initial = {
      label: "Owner A", currency: "USD",
      incomeSources: [{ name: "Existing job", type: "employment", amount: 1000, basis: "net", frequency: "monthly", regularity: "regular" }],
      financialAccounts: [{ name: "Existing bank", accountType: "depository", balance: 500, balanceSource: "manual" }],
      retirementContributionPlans: [{ name: "Existing plan", contribution: { basis: "amount", amount: 100 } }],
      debts: [{ name: "Existing debt", balance: 250 }],
      recurringExpenses: [{ name: "Existing bill", amount: 25, frequency: "monthly" }],
      savingsAllocations: [{ name: "Existing savings", amount: 50, frequency: "monthly" }],
      goals: [{ name: "Existing goal", targetAmount: 400 }],
    };
    const { supabase, reload } = persistentProfileClient({ "owner-a": initial });
    const partial = new FormData();
    partial.set("incomeSources", JSON.stringify([{ name: "Updated job", type: "employment", amount: 1200, basis: "net", frequency: "monthly", regularity: "regular" }]));
    await saveAs("owner-a", supabase, partial);
    expect(await reload("owner-a")).toMatchObject({ ...initial, incomeSources: [{ name: "Updated job", type: "employment", amount: 1200, basis: "net", frequency: "monthly", regularity: "regular" }] });

    const clear = new FormData();
    clear.set("incomeSources", "[]");
    await saveAs("owner-a", supabase, clear);
    expect((await reload("owner-a")).incomeSources).toEqual([]);
    expect((await reload("owner-a")).financialAccounts).toEqual(initial.financialAccounts);
  });

  it("rejects invalid collection data without overwriting the saved profile", async () => {
    const initial = { label: "Owner A", currency: "USD", debts: [{ name: "Valid debt", balance: 0 }] };
    const { supabase, rows, writeIds } = persistentProfileClient({ "owner-a": initial });
    const form = new FormData();
    form.set("debts", JSON.stringify([{ name: "Invalid debt", balance: -500 }]));
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue({ user: { id: "owner-a" }, supabase });

    const result = await saveFinancialProfile({ errors: {} }, form);
    expect(result.errors.debts).toBeDefined();
    expect(writeIds).toEqual([]);
    expect(rows.get("owner-a")).toEqual(initial);
  });

  it("isolates two owners even when each form submits the other owner's ID", async () => {
    const { supabase, readIds, writeIds, reload } = persistentProfileClient({
      "owner-a": { label: "Owner A", currency: "USD", incomeSources: [] },
      "owner-b": { label: "Owner B", currency: "USD", incomeSources: [] },
    });
    const formA = new FormData();
    formA.set("user_id", "owner-b");
    formA.set("incomeSources", JSON.stringify([{ name: "Fictional A job", type: "employment", amount: 100, basis: "net", frequency: "monthly" }]));
    await saveAs("owner-a", supabase, formA);
    const formB = new FormData();
    formB.set("user_id", "owner-a");
    formB.set("incomeSources", JSON.stringify([{ name: "Fictional B job", type: "employment", amount: 200, basis: "net", frequency: "monthly" }]));
    await saveAs("owner-b", supabase, formB);
    const reloadedA = await reload("owner-a");
    const reloadedB = await reload("owner-b");

    expect(readIds).toEqual(["owner-a", "owner-b", "owner-a", "owner-b"]);
    expect(writeIds).toEqual(["owner-a", "owner-b"]);
    expect(reloadedA.incomeSources).toMatchObject([{ name: "Fictional A job", amount: 100 }]);
    expect(reloadedB.incomeSources).toMatchObject([{ name: "Fictional B job", amount: 200 }]);
  });

  it("detects concurrent saves from the same profile version and lets a retry merge with the latest version", async () => {
    const initial = { label: "Owner A", currency: "USD", incomeSources: [], debts: [] };
    const { supabase, rows, writeIds, reload } = persistentProfileClient(
      { "owner-a": initial },
      { synchronizeFirstTwoReads: true },
    );
    mocks.getAuthenticatedSupabaseContext.mockResolvedValue({ user: { id: "owner-a" }, supabase });

    const incomeForm = new FormData();
    incomeForm.set("incomeSources", JSON.stringify([{ name: "Concurrent job", type: "employment", amount: 100, basis: "net", frequency: "monthly" }]));
    const debtForm = new FormData();
    debtForm.set("debts", JSON.stringify([{ name: "Concurrent debt", balance: 50 }]));

    const concurrentResults = await Promise.allSettled([
      saveFinancialProfile({ errors: {} }, incomeForm),
      saveFinancialProfile({ errors: {} }, debtForm),
    ]);
    const conflict = concurrentResults.find((result) => result.status === "fulfilled");
    const redirectedSuccess = concurrentResults.find((result) => result.status === "rejected");
    expect(conflict).toMatchObject({
      status: "fulfilled",
      value: {
        conflict: true,
        message: expect.stringContaining("Reload the latest profile"),
      },
    });
    expect(redirectedSuccess).toMatchObject({ status: "rejected" });
    const afterConflict = await reload("owner-a");
    const incomeWon = Array.isArray(afterConflict.incomeSources) && afterConflict.incomeSources.length > 0;
    const debtWon = Array.isArray(afterConflict.debts) && afterConflict.debts.length > 0;
    expect(Number(incomeWon) + Number(debtWon)).toBe(1);

    const retryForm = incomeWon ? debtForm : incomeForm;
    await expect(saveFinancialProfile({ errors: {}, conflict: true }, retryForm)).rejects.toThrow("redirect:/");
    const afterRetry = await reload("owner-a");
    expect(afterRetry.incomeSources).toMatchObject([{ name: "Concurrent job" }]);
    expect(afterRetry.debts).toMatchObject([{ name: "Concurrent debt" }]);
    expect(writeIds).toEqual(["owner-a", "owner-a", "owner-a"]);
    expect(rows.get("owner-a")).toMatchObject({ incomeSources: [{ name: "Concurrent job" }], debts: [{ name: "Concurrent debt" }] });
  });
});
