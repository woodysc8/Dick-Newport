export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  const expectedOrigin = configuredOrigin ? new URL(configuredOrigin).origin : new URL(request.url).origin;
  return origin === expectedOrigin;
}
