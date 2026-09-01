/**
 * Stellar SEP-0007 QR payment payload formatter.
 *
 * Formats a canonical `web+stellar:pay` URI for QR code generation and wallet
 * payment requests. Adheres to SEP-0007 URI scheme conventions:
 * - `destination`: recipient Stellar account public key.
 * - `amount`: payment amount in decimal or string format.
 * - `asset_code` & `asset_issuer`: included for non-native (credit) assets.
 * - `memo` & `memo_type`: payment reference / memo text, URL-encoded.
 */

export interface AssetSpec {
  code?: string;
  assetCode?: string;
  issuer?: string;
  assetIssuer?: string;
  kind?: string;
}

export type QrPaymentAssetInput = string | AssetSpec;

export interface FormatQrPaymentPayloadOptions {
  destination: string;
  amount?: string | number;
  memo?: string;
  memoType?: string;
  asset?: QrPaymentAssetInput;
  assetCode?: string;
  assetIssuer?: string;
}

/**
 * Format a SEP-0007 pay URI for QR code generation.
 *
 * @param options Object containing destination, amount, optional memo and asset details.
 * @returns Serialized `web+stellar:pay?...` URI string.
 */
export function formatQrPaymentPayload(options: FormatQrPaymentPayloadOptions): string {
  if (!options || typeof options !== 'object') {
    throw new Error('Options object is required for formatQrPaymentPayload');
  }

  const destination = (options.destination ?? '').trim();
  if (!destination) {
    throw new Error('Destination is required for QR payment payload');
  }

  let amountStr: string | undefined;
  if (options.amount !== undefined && options.amount !== null) {
    const str = String(options.amount).trim();
    if (str !== '') {
      amountStr = str;
    }
  }

  // Resolve asset code and issuer
  let code: string | undefined;
  let issuer: string | undefined;

  if (typeof options.asset === 'string') {
    code = options.asset.trim();
  } else if (options.asset && typeof options.asset === 'object') {
    code = (options.asset.code ?? options.asset.assetCode)?.trim();
    issuer = (options.asset.issuer ?? options.asset.assetIssuer)?.trim();
  }

  if (!code && options.assetCode) {
    code = options.assetCode.trim();
  }
  if (!issuer && options.assetIssuer) {
    issuer = options.assetIssuer.trim();
  }

  if (!code) {
    code = 'XLM';
  }

  // Resolve memo and memo_type
  let memoStr: string | undefined;
  if (options.memo !== undefined && options.memo !== null) {
    const str = String(options.memo).trim();
    if (str !== '') {
      memoStr = str;
    }
  }

  const memoType = (options.memoType ?? '').trim() || 'MEMO_TEXT';

  let stellarUri = `web+stellar:pay?destination=${destination}`;

  if (amountStr !== undefined) {
    stellarUri += `&amount=${amountStr}`;
  }

  // Add credit asset information if non-native and issuer is provided
  if (code !== 'XLM' && issuer) {
    stellarUri += `&asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}`;
  }

  if (memoStr !== undefined) {
    stellarUri += `&memo=${encodeURIComponent(memoStr)}&memo_type=${encodeURIComponent(memoType)}`;
  }

  return stellarUri;
}

export default {
  formatQrPaymentPayload,
};
