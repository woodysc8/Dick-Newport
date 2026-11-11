import { afterEach, describe, expect, it, vi } from "vitest";
import { CredentialConfigurationError } from "./plaidCredentialConfiguration";
import { isSameOriginRequest } from "./requestSecurity";

afterEach(() => vi.unstubAllEnvs());
const browser = (origin = "http://localhost:3000") => new Request("http://localhost:3000/api/plaid/credentials", { method: "POST", headers: { Origin: origin } });
describe("browser mutation origin configuration", () => {
  it.each(["invalid-origin", "file:///tmp/site", "javascript:invalid", "https://synthetic-user:synthetic-password@example.com"])("rejects invalid site configuration with a safe, specific error", value => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", value);
    expect(() => isSameOriginRequest(browser())).toThrow(CredentialConfigurationError);
    try { isSameOriginRequest(browser()); } catch (error) {
      expect((error as CredentialConfigurationError).code).toBe("ORIGIN_CONFIGURATION_INVALID");
      expect((error as Error).message).not.toContain(value);
    }
  });
  it("permits the repaired local origin and still rejects unrelated browser origins", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    expect(isSameOriginRequest(browser())).toBe(true);
    expect(isSameOriginRequest(browser("https://attacker.example"))).toBe(false);
  });
});
