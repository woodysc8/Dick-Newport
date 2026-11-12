export function holdingNumber(value: unknown): number | null {
  return value == null || (typeof value === "string" && !value.trim()) || !["number", "string"].includes(typeof value) || !Number.isFinite(Number(value)) ? null : Number(value);
}
/** Cost basis is the total recorded position basis, not a per-share price. */
export function unrealizedHoldingReturn(value: unknown, basis: unknown, quantity: unknown) {
  const marketValue = holdingNumber(value), costBasis = holdingNumber(basis), units = holdingNumber(quantity);
  if (marketValue == null || costBasis == null || units == null || marketValue < 0 || costBasis < 0 || units < 0) return { amount: null, percent: null };
  const amount = Math.round((marketValue - costBasis) * 100) / 100;
  if (!Number.isFinite(amount)) return { amount: null, percent: null };
  const percent = costBasis > 0 ? amount / costBasis * 100 : null;
  return { amount, percent: percent != null && Number.isFinite(percent) ? percent : null };
}
export function holdingPrice(value: unknown, currency: string | null | undefined) {
  const price = holdingNumber(value);
  if (price == null || !currency || !/^[A-Z]{3}$/.test(currency)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 12, ...(price !== 0 && Math.abs(price) < 1e-12 ? { notation: "scientific" as const } : {}) }).format(price);
}
