// Stellar asset configuration — backed by the shared registry (issue #447).
import {
  KNOWN_ASSETS,
  getAssetDefinition,
  isNativeAsset as canonicalIsNativeAsset,
  getAssetIssuer as canonicalGetAssetIssuer,
  formatAssetName as canonicalFormatAssetName,
  formatAssetLabel,
  decimalsForAsset,
  USDC_ISSUERS,
} from '../../shared/assets.ts';

export { formatAssetLabel, USDC_ISSUERS };

export interface StellarAsset {
  code: string;
  name: string;
  issuer?: string;
  logo: string;
  color: string;
  decimals: number;
}

function toStellarAsset(
  asset: (typeof KNOWN_ASSETS)[number],
  network: string = 'TESTNET',
): StellarAsset {
  return {
    code: asset.code,
    name: asset.name,
    issuer: asset.isNative
      ? undefined
      : canonicalGetAssetIssuer(asset.code, network),
    logo: asset.logo,
    color: asset.color,
    decimals: asset.decimals,
  };
}

/** Assets a seller can choose, pinned to the given network's issuers. */
export function stellarAssetsForNetwork(network: string = 'TESTNET'): StellarAsset[] {
  return KNOWN_ASSETS.map((asset) => toStellarAsset(asset, network));
}

/** Default catalog (testnet issuers) — preserved for existing call sites. */
export const STELLAR_ASSETS: StellarAsset[] = stellarAssetsForNetwork('TESTNET');

export const getAssetByCode = (
  code: string,
  network: string = 'TESTNET',
): StellarAsset | undefined => {
  const asset = getAssetDefinition(code);
  if (!asset) return undefined;
  return toStellarAsset(asset, network);
};

export const isNativeAsset = (code: string): boolean => {
  return canonicalIsNativeAsset(code);
};

export const getAssetIssuer = (
  code: string,
  network: string = 'TESTNET',
): string | undefined => {
  return canonicalGetAssetIssuer(code, network);
};

export const formatAssetName = (code: string): string => {
  return canonicalFormatAssetName(code);
};

export interface AssetLogoProps {
  code: string;
  size?: number;
  showName?: boolean;
  className?: string;
}

export { decimalsForAsset };
