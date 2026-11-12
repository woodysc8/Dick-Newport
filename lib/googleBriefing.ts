import { createSign } from "node:crypto";
import { managedMarker } from "./financialBriefing";

export class BriefingError extends Error {
  constructor(
    public category:
      | "CONFIGURATION"
      | "UNAVAILABLE"
      | "PROVIDER_REJECTED"
      | "STALE_PREVIEW",
  ) {
    super(
      category === "CONFIGURATION"
        ? "Private Google Doc publishing is disabled or not configured. See the setup guide."
        : category === "STALE_PREVIEW"
          ? "The preview changed or expired. Preview again before publishing."
          : "Private document publishing did not complete. Retry after checking authorization and document privacy.",
    );
  }
}
export function googleBriefingConfig(userId: string) {
  if (
    process.env.GOOGLE_BRIEFING_ENABLED !== "true" ||
    process.env.GOOGLE_BRIEFING_OWNER_USER_ID !== userId
  )
    throw new BriefingError("CONFIGURATION");
  const documentId = process.env.GOOGLE_BRIEFING_DOCUMENT_ID,
    clientEmail = process.env.GOOGLE_BRIEFING_CLIENT_EMAIL,
    privateKey = process.env.GOOGLE_BRIEFING_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    ownerEmail = process.env.GOOGLE_BRIEFING_OWNER_EMAIL;
  if (
    !documentId ||
    !/^[A-Za-z0-9_-]{10,200}$/.test(documentId) ||
    !clientEmail ||
    !privateKey ||
    !ownerEmail
  )
    throw new BriefingError("CONFIGURATION");
  return {
    documentId,
    clientEmail,
    privateKey,
    ownerEmail,
    readers: (process.env.GOOGLE_BRIEFING_READER_EMAILS ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  };
}
type Fetcher = typeof fetch;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function publishGoogleBriefing(
  userId: string,
  text: string,
  options: { fetcher?: Fetcher; wait?: (ms: number) => Promise<unknown> } = {},
) {
  const config = googleBriefingConfig(userId),
    fetcher = options.fetcher ?? fetch,
    wait = options.wait ?? sleep;
  if (text.length > 30000 || !text.startsWith(managedMarker))
    throw new BriefingError("CONFIGURATION");
  const call = async (url: string, init: RequestInit) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetcher(url, {
          ...init,
          signal: AbortSignal.timeout(15000),
          redirect: "error",
          cache: "no-store",
        });
      } catch {
        throw new BriefingError("UNAVAILABLE");
      }
      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new BriefingError("UNAVAILABLE");
        }
      }
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await wait(250 * 2 ** attempt);
        continue;
      }
      throw new BriefingError(
        response.status === 409 || response.status === 400
          ? "STALE_PREVIEW"
          : "PROVIDER_REJECTED",
      );
    }
    throw new BriefingError("UNAVAILABLE");
  };
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const seconds = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: config.clientEmail, scope: "https://www.googleapis.com/auth/drive.file", aud: "https://oauth2.googleapis.com/token", iat: seconds, exp: seconds + 300 })}`;
  let assertion: string;
  try {
    assertion = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(config.privateKey, "base64url")}`;
  } catch {
    throw new BriefingError("CONFIGURATION");
  }
  const token = await call("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });
  if (typeof token.access_token !== "string")
    throw new BriefingError("PROVIDER_REJECTED");
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    "Content-Type": "application/json",
  };
  const file = await call(
    `https://www.googleapis.com/drive/v3/files/${config.documentId}?fields=id,mimeType,trashed,owners(emailAddress),permissions(type,emailAddress,role),capabilities(canEdit)`,
    { headers },
  );
  const allowed = new Set(
    [config.ownerEmail, config.clientEmail, ...config.readers].map((s) =>
      s.toLowerCase(),
    ),
  );
  if (
    file.trashed ||
    file.mimeType !== "application/vnd.google-apps.document" ||
    file.capabilities?.canEdit !== true ||
    !Array.isArray(file.owners) ||
    !file.owners.some(
      (o: { emailAddress?: string }) =>
        o.emailAddress?.toLowerCase() === config.ownerEmail.toLowerCase(),
    ) ||
    !Array.isArray(file.permissions) ||
    file.permissions.some(
      (p: { type?: string; emailAddress?: string }) =>
        p.type !== "user" ||
        !p.emailAddress ||
        !allowed.has(p.emailAddress.toLowerCase()),
    )
  )
    throw new BriefingError("PROVIDER_REJECTED");
  const doc = await call(
    `https://docs.googleapis.com/v1/documents/${config.documentId}`,
    { headers },
  );
  const content = doc.body?.content;
  if (
    !doc.revisionId ||
    !Array.isArray(content) ||
    doc.tabs?.length > 1 ||
    content.some(
      (c: { table?: unknown; tableOfContents?: unknown }) =>
        c.table || c.tableOfContents,
    )
  )
    throw new BriefingError("PROVIDER_REJECTED");
  const current = content
    .flatMap(
      (c: {
        paragraph?: { elements?: { textRun?: { content?: string } }[] };
      }) => c.paragraph?.elements ?? [],
    )
    .map((e: { textRun?: { content?: string } }) => e.textRun?.content ?? "")
    .join("");
  if (current === text) return { published: true, unchanged: true };
  if (current.trim() && !current.startsWith(managedMarker))
    throw new BriefingError("PROVIDER_REJECTED");
  const end = Number(content.at(-1)?.endIndex);
  if (!Number.isInteger(end) || end < 2)
    throw new BriefingError("PROVIDER_REJECTED");
  const requests = [
    ...(end > 2
      ? [
          {
            deleteContentRange: { range: { startIndex: 1, endIndex: end - 1 } },
          },
        ]
      : []),
    { insertText: { location: { index: 1 }, text: text.replace(/\n$/, "") } },
  ];
  // Google validates the whole batch before applying it. Revision guard makes
  // an uncertain retry fail safely rather than append a second briefing.
  await call(
    `https://docs.googleapis.com/v1/documents/${config.documentId}:batchUpdate`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        writeControl: { requiredRevisionId: doc.revisionId },
        requests,
      }),
    },
  );
  return { published: true, unchanged: false };
}
