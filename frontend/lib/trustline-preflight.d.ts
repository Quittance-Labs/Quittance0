export type TrustlinePreflightStatus =
  | 'not_required'
  | 'trustline_exists'
  | 'missing_trustline'
  | 'no_account'
  | 'outage'
  | 'idle';

export type TrustlinePreflightAction = 'none' | 'add_trustline' | 'fund' | 'retry';

export interface TrustlinePreflightResult {
  status: TrustlinePreflightStatus;
  ready: boolean;
  canPay: boolean;
  isOutage?: boolean;
  title: string;
  message: string | null;
  action: TrustlinePreflightAction;
}

export interface HorizonAccountBalance {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
  balance?: string;
  limit?: string;
}

export interface HorizonAccountLike {
  id?: string;
  balances?: HorizonAccountBalance[];
}

export function isNativeAsset(assetCode?: string | null): boolean;

export function hasAssetTrustline(
  account?: HorizonAccountLike | null,
  assetCode?: string,
  assetIssuer?: string
): boolean;

export function isNotFoundError(error: unknown): boolean;

export function evaluatePayerTrustline(params: {
  account?: HorizonAccountLike | null;
  error?: unknown;
  assetCode?: string | null;
  assetIssuer?: string | null;
}): TrustlinePreflightResult;

export function checkPayerTrustline(params: {
  loadAccountFn: (publicKey: string) => Promise<any>;
  publicKey?: string | null;
  assetCode?: string | null;
  assetIssuer?: string | null;
}): Promise<TrustlinePreflightResult>;
