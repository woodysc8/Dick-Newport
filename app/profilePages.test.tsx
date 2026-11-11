import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseServerClient: vi.fn(),
  ensureOwnProfile: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("next/link", () => ({ default: ({ children, ...props }: { children: unknown; href: string }) => ({ type: "a", props: { ...props, children } }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("../lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
  ensureOwnProfile: mocks.ensureOwnProfile,
}));
vi.mock("./components/FinancialProfileForm", () => ({ default: () => "financial-profile-form" }));
vi.mock("./components/PersonalPlaidCredentials", () => ({ default: () => "personal-plaid-credentials" }));

import OnboardingPage from "./onboarding/page";
import ProfileSettingsPage from "./settings/profile/page";

function profileClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-a" } } }) },
    from: vi.fn(() => ({ select })),
  };
}

function renderedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(renderedText).join("");
  if (value && typeof value === "object" && "props" in value) {
    const element = value as { type?: unknown; props: { children?: unknown } };
    if (typeof element.type === "function") return renderedText(element.type(element.props));
    return renderedText(element.props.children);
  }
  return "";
}

describe("profile page loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureOwnProfile.mockResolvedValue(undefined);
  });

  it("renders an existing onboarding profile", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(profileClient({
      data: { financial_profile: { label: "Saved profile", currency: "EUR" } },
      error: null,
    }));

    const page = await OnboardingPage();

    expect(renderedText(page)).toContain("financial-profile-form");
    expect(renderedText(page)).not.toContain("could not be loaded");
  });

  it("renders the starter onboarding form when no profile exists", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(profileClient({ data: null, error: null }));

    const page = await OnboardingPage();

    expect(renderedText(page)).toContain("financial-profile-form");
    expect(renderedText(page)).toContain("Skip profile setup and open dashboard");
  });

  it("does not render an onboarding form when the profile read fails", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(profileClient({ data: null, error: { message: "database unavailable" } }));

    const page = await OnboardingPage();

    expect(renderedText(page)).toContain("could not be loaded");
    expect(renderedText(page)).not.toContain("financial-profile-form");
    expect(renderedText(page)).toContain("Try again");
  });

  it("renders an existing settings profile", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(profileClient({
      data: { financial_profile: { label: "Saved profile", currency: "GBP" } },
      error: null,
    }));

    const page = await ProfileSettingsPage({ searchParams: Promise.resolve({}) });

    expect(renderedText(page)).toContain("financial-profile-form");
    expect(renderedText(page)).toContain("personal-plaid-credentials");
  });

  it("renders the starter settings form when no profile exists", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(profileClient({ data: null, error: null }));

    const page = await ProfileSettingsPage({ searchParams: Promise.resolve({}) });

    expect(renderedText(page)).toContain("financial-profile-form");
  });

  it("does not render a settings form when the profile read fails", async () => {
    mocks.createSupabaseServerClient.mockResolvedValue(profileClient({ data: null, error: { message: "database unavailable" } }));

    const page = await ProfileSettingsPage({ searchParams: Promise.resolve({}) });

    expect(renderedText(page)).toContain("could not be loaded");
    expect(renderedText(page)).not.toContain("financial-profile-form");
    expect(renderedText(page)).toContain("Try again");
  });
});
