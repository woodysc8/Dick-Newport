export type InvestmentAssetValue = {
  tickerSymbol?: string | null;
  securityName?: string | null;
  currency?: string | null;
  value: number | string | null;
};

function normalized(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

export function isCashEquivalentAsset(asset: InvestmentAssetValue): boolean {
  const ticker = normalized(asset.tickerSymbol);
  const name = normalized(asset.securityName);
  const currency = normalized(asset.currency);

  return ticker === "CUR:USD" || name === "CUR:USD" || name === "CURRENCY: USD" || (currency === "USD" && name === "USD");
}

export function calculateSecuritiesOnlyValue(assets: readonly InvestmentAssetValue[]): number | null {
  const securities = assets.filter((asset) => !isCashEquivalentAsset(asset));
  if (securities.length === 0) return null;

  const currencies = new Set(securities.map((asset) => normalized(asset.currency)).filter(Boolean));
  if (currencies.size !== 1 || securities.some((asset) => !normalized(asset.currency))) return null;

  const values = securities.map((asset) => Number(asset.value));
  if (values.some((value) => !Number.isFinite(value))) return null;
  return values.reduce((total, value) => total + value, 0);
}