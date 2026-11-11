// Public messages are fixed strings; never include configured values or causes.
export const credentialConfigurationMessages = {
  ORIGIN_CONFIGURATION_INVALID: "The server site URL is invalid. Set NEXT_PUBLIC_SITE_URL to the application's http:// or https:// address, restart the server, and retry.",
  ENCRYPTION_CONFIGURATION_INVALID: "Credential encryption is unavailable. The administrator must configure a 32-byte base64 PLAID_CREDENTIAL_ENCRYPTION_KEY and restart the server. Do not rotate an existing key.",
  SERVICE_CONFIGURATION_INVALID: "The server Supabase configuration is incomplete. The administrator must check the Supabase URL and service-role configuration and restart the server.",
} as const;
export type CredentialConfigurationCode = keyof typeof credentialConfigurationMessages;
export class CredentialConfigurationError extends Error {
  readonly status = 503;
  constructor(readonly code: CredentialConfigurationCode) { super(credentialConfigurationMessages[code]); }
}
export type CredentialStage = "origin_validation" | "authentication" | "service_client" | "lock_acquire" | "body_validation" | "credential_status" | "encryption" | "plaid_verification" | "persistence" | "revocation" | "lock_release";
export type CredentialStageReporter = (stage: CredentialStage) => void;
