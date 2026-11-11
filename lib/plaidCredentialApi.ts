// Browser-safe contract: this module never imports server credentials or the Plaid SDK.
import { credentialConfigurationMessages } from "./plaidCredentialConfiguration";
export type CredentialStatus = {
  configured: boolean;
  environment?: "sandbox" | "production";
  status?: "active" | "revoking";
  verifiedAt?: string | null;
};
export type CredentialAction = "save" | "replace" | "verify" | "delete";
export type CredentialInput = { clientId: string; secret: string; environment: string };

export class CredentialResponseError extends Error {}

function httpError(status: number) {
  switch (status) {
    case 401: return "Your session has expired. Sign in and retry.";
    case 403: return "The request was blocked. Open Settings from the configured application address.";
    case 400: return "Check the Client ID, API secret, environment, and request format.";
    case 409: return "A credential operation needs attention. Refresh status and retry; finish pending deletion before replacing credentials.";
    case 422: return "Plaid could not verify these credentials. Check the Client ID, secret, environment, and Production access in your personal Plaid Dashboard.";
    case 405: return "This server does not support the credential operation. Restart or update the application, then refresh status.";
    default: return `The credential request failed (HTTP ${status}). Refresh status before retrying; contact the administrator if it continues.`;
  }
}

export async function readCredentialResponse(response: Response): Promise<CredentialStatus> {
  if (response.redirected || response.type === "opaqueredirect") throw new CredentialResponseError("Your session may have expired. Sign in and refresh status.");
  let text: string;
  try { text = await response.text(); }
  catch { throw new CredentialResponseError(`The server response was interrupted (HTTP ${response.status}). Refresh status before retrying.`); }
  if (!text.trim()) throw new CredentialResponseError(`The server returned an empty response (HTTP ${response.status}). Refresh status before retrying.`);
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
    throw new CredentialResponseError(`The server returned a non-JSON response (HTTP ${response.status}). Refresh status before retrying.`);
  }
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { throw new CredentialResponseError(`The server returned invalid JSON (HTTP ${response.status}). Refresh status before retrying.`); }
  // Never reflect arbitrary upstream error bodies, HTML, or native exception text.
  if (!response.ok) {
    const code = data && typeof data === "object" && "code" in data ? data.code : null;
    if (typeof code === "string" && Object.hasOwn(credentialConfigurationMessages, code)) {
      throw new CredentialResponseError(credentialConfigurationMessages[code as keyof typeof credentialConfigurationMessages]);
    }
    throw new CredentialResponseError(httpError(response.status));
  }
  if (typeof data !== "object" || data === null || Array.isArray(data) || !("configured" in data) || typeof data.configured !== "boolean") {
    throw new CredentialResponseError("The server returned an invalid credential status. Refresh status before retrying.");
  }
  if (!data.configured) return { configured: false };
  const saved = data as Record<string, unknown>;
  if ((saved.environment !== "sandbox" && saved.environment !== "production") ||
    (saved.status !== "active" && saved.status !== "revoking") ||
    (saved.verifiedAt != null && (typeof saved.verifiedAt !== "string" || !Number.isFinite(Date.parse(saved.verifiedAt))))) {
    throw new CredentialResponseError("The server returned an invalid credential status. Refresh status before retrying.");
  }
  return { configured: true, environment: saved.environment, status: saved.status, verifiedAt: saved.verifiedAt as string | null | undefined };
}

export async function requestCredentialStatus(action?: CredentialAction, input?: CredentialInput, signal?: AbortSignal): Promise<CredentialStatus> {
  let response: Response;
  try {
    response = await fetch("/api/plaid/credentials", {
      method: !action ? "GET" : action === "delete" ? "DELETE" : action === "replace" ? "PUT" : "POST",
      cache: "no-store", credentials: "same-origin", signal,
      headers: { Accept: "application/json", ...(action && action !== "delete" ? { "Content-Type": "application/json" } : {}) },
      ...(action && action !== "delete" ? { body: JSON.stringify(action === "verify" ? { action: "verify" } : input) } : {}),
    });
  } catch { throw new CredentialResponseError("Unable to reach the credential server. Refresh status before retrying."); }
  return readCredentialResponse(response);
}
