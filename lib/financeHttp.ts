export class FinanceRequestError extends Error {}
export async function financeRequest<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, cache: "no-store" });
  } catch {
    throw new FinanceRequestError("Unable to reach the server. Retry shortly.");
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new FinanceRequestError(
      "The server returned an unreadable response. Retry shortly.",
    );
  }
  if (!data || typeof data !== "object")
    throw new FinanceRequestError(
      "The server returned an invalid response. Retry shortly.",
    );
  if (!response.ok)
    throw new FinanceRequestError(
      typeof data.error === "string"
        ? data.error
        : "This request could not be completed. Retry shortly.",
    );
  return data as T;
}
export const jsonMutation = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
