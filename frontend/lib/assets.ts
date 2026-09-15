// Stellar Asset Configuration
// Canonical definitions unified in shared/assets.ts (Issue #447).

import {
  KNOWN_ASSETS,
  AssetDefinition,
  getAssetDefinition,
  isNativeAsset as canonicalIsNativeAsset,
  getAssetIssuer as canonicalGetAssetIssuer,
  formatAssetName as canonicalFormatAssetName,
  decimalsForAsset,
} from '../../shared/assets.ts';

export interface StellarAsset {
  code: string;
  name: string;
  issuer?: string;
  logo: string;
  color: string;
  decimals: number;
}

// Canonical asset list matching StellarAsset interface
export const STELLAR_ASSETS: StellarAsset[] = KNOWN_ASSETS.map((asset) => ({
  code: asset.code,
  name: asset.name,
  issuer: asset.issuer,
  logo: asset.logo,
  color: asset.color,
  decimals: asset.decimals,
}));

// Get asset by code
export const getAssetByCode = (code: string): StellarAsset | undefined => {
  const asset = getAssetDefinition(code);
  if (!asset) return undefined;
  return {
    code: asset.code,
    name: asset.name,
    issuer: asset.issuer,
    logo: asset.logo,
    color: asset.color,
    decimals: asset.decimals,
  };
};

// Check if asset is native XLM
export const isNativeAsset = (code: string): boolean => {
  return canonicalIsNativeAsset(code);
};

// Get asset issuer address if applicable
export const getAssetIssuer = (code: string): string | undefined => {
  return canonicalGetAssetIssuer(code);
};

// Format asset display name
export const formatAssetName = (code: string): string => {
  return canonicalFormatAssetName(code);
};

// Asset Logo Component Props
export interface AssetLogoProps {
  code: string;
  size?: number;
  showName?: boolean;
  className?: string;
}

export { decimalsForAsset };

export default {
  STELLAR_ASSETS,
  getAssetByCode,
  isNativeAsset,
  getAssetIssuer,
  formatAssetName,
  decimalsForAsset,
};
