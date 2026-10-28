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

export function calculateSecuritiesOnlyValue(assets: readonly InvestmentAssetValue[]): number {
  return assets.reduce((total, asset) => {
    if (isCashEquivalentAsset(asset)) return total;
    const value = Number(asset.value);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
}