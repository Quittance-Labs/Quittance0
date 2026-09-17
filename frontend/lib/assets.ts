import {
  KNOWN_ASSETS,
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

export const STELLAR_ASSETS: StellarAsset[] = KNOWN_ASSETS.map((asset) => ({
  code: asset.code,
  name: asset.name,
  issuer: asset.issuer,
  logo: asset.logo,
  color: asset.color,
  decimals: asset.decimals,
}));

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

export const isNativeAsset = (code: string): boolean => {
  return canonicalIsNativeAsset(code);
};

export const getAssetIssuer = (code: string): string | undefined => {
  return canonicalGetAssetIssuer(code);
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

export default {
  STELLAR_ASSETS,
  getAssetByCode,
  isNativeAsset,
  getAssetIssuer,
  formatAssetName,
  decimalsForAsset,
};
