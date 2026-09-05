/**
 * QR Payment Payload Formatter for SEP-0007 Stellar pay URI format.
 */

export interface QrPaymentAsset {
  code?: string;
  issuer?: string;
}

export interface FormatQrPaymentPayloadOptions {
  destination: string;
  amount: string | number;
  memo?: string;
  asset?: QrPaymentAsset | string;
  assetIssuer?: string;
}

/**
 * Formats a SEP-0007 compliant Stellar pay URI payload for QR code generation.
 * e.g. web+stellar:pay?destination=G...&amount=10&asset_code=USDC&asset_issuer=G...&memo=INV-123&memo_type=MEMO_TEXT
 */
export function formatQrPaymentPayload(options: FormatQrPaymentPayloadOptions): string {
  const { destination, amount, memo, asset, assetIssuer } = options;

  if (!destination || typeof destination !== 'string') {
    throw new Error('Destination address is required and must be a non-empty string');
  }

  if (amount === undefined || amount === null || amount === '') {
    throw new Error('Amount is required');
  }

  const normalizedAmount = String(amount);
  let uri = `web+stellar:pay?destination=${destination}&amount=${normalizedAmount}`;

  let code = 'XLM';
  let issuer: string | undefined = assetIssuer;

  if (typeof asset === 'string') {
    code = asset;
  } else if (asset && typeof asset === 'object') {
    if (asset.code) code = asset.code;
    if (asset.issuer) issuer = asset.issuer;
  }

  if (code !== 'XLM' && issuer) {
    uri += `&asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}`;
  }

  if (memo) {
    uri += `&memo=${encodeURIComponent(memo)}&memo_type=MEMO_TEXT`;
  }

  return uri;
}
