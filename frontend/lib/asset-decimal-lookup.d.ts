export const DEFAULT_DECIMALS: number;
export const ASSET_DECIMALS: Readonly<Record<string, number>>;
export function assetDecimalLookup(assetCode?: string | null): number;
