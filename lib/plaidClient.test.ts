import { afterEach, describe, expect, it, vi } from "vitest";
import { createLinkTokenRequest, createPlaidClient } from "./plaidClient";
import { decryptPlaidSecret, encryptPlaidSecret } from "./plaidEncryption";
import { safePlaidError } from "./plaidOperations";

afterEach(() => vi.unstubAllEnvs());
describe("personal Plaid encryption and configuration", () => {
  it("uses randomized authenticated encryption bound to owner, version and environment", () => {
    vi.stubEnv("PLAID_CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    const ciphertext = encryptPlaidSecret("synthetic-secret", "a:version:sandbox");
    expect(ciphertext).not.toContain("synthetic-secret");
    expect(encryptPlaidSecret("synthetic-secret", "a:version:sandbox")).not.toBe(ciphertext);
    expect(decryptPlaidSecret(ciphertext, "a:version:sandbox")).toBe("synthetic-secret");
    for (const binding of ["b:version:sandbox", "a:replaced:sandbox", "a:version:production"]) {
      expect(() => decryptPlaidSecret(ciphertext, binding)).toThrow("Unable to decrypt");
    }
    vi.stubEnv("PLAID_CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 2).toString("base64"));
    expect(() => decryptPlaidSecret(ciphertext, "a:version:sandbox")).toThrow("Unable to decrypt");
  });
  it("rejects malformed, truncated and tampered ciphertext without exposing values", () => {
    vi.stubEnv("PLAID_CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    const value = encryptPlaidSecret("synthetic-secret", "a");
    for (const invalid of ["", "v2.a.b.c", value + ".extra", value.slice(0, -4), value.replace("v1.", "v1.!!"), "x".repeat(9000)]) {
      expect(() => decryptPlaidSecret(invalid, "a")).toThrow("Unable to decrypt saved Plaid credentials");
    }
    vi.stubEnv("PLAID_CREDENTIAL_ENCRYPTION_KEY", "invalid");
    expect(() => encryptPlaidSecret("synthetic-secret", "a")).toThrow("not configured");
  });
  it("isolates Sandbox and Production without consulting shared environment credentials", () => {
    vi.stubEnv("PLAID_CLIENT_ID", "global-must-not-be-used");
    vi.stubEnv("PLAID_SECRET", "global-must-not-be-used");
    for (const environment of ["sandbox", "production"] as const) {
      const client = createPlaidClient({ clientId: "personal-id", secret: "personal-secret", environment });
      const config = (client as unknown as { configuration: { basePath: string; baseOptions: { headers: Record<string, string> } } }).configuration;
      expect(config.basePath).toBe(`https://${environment}.plaid.com`);
      expect(config.baseOptions.headers["PLAID-CLIENT-ID"]).toBe("personal-id");
    }
    expect(() => createPlaidClient(undefined as never)).toThrow("Personal Plaid credentials are required");
    expect(createLinkTokenRequest("a").user.client_user_id).toBe("a");
  });
  it("maps only known errors and never reflects sensitive provider responses", () => {
    expect(safePlaidError({ response: { data: { error_code: "PRODUCTION_ACCESS_NOT_GRANTED" } } })).toContain("Production");
    expect(safePlaidError({ response: { data: { error_code: "PRODUCT_NOT_SUPPORTED" } } })).toContain("does not support");
    expect(safePlaidError({ message: "secret", response: { data: { error_message: "secret", error_code: "secret" } } })).not.toContain("secret");
  });
});
