import QRCode from 'qrcode';
import { formatQrPaymentPayload } from './qr-payment-payload';
import { fitsSep7QrBudget } from './qr-budget';

/**
 * Generate QR code for payment URL.
 *
 * @param paymentUrl - Payment URL to encode into QR code.
 * @returns Base64 data URL string for QR image.
 */
export const generatePaymentQR = async (paymentUrl: string): Promise<string> => {
  try {
    const qrDataUrl = await QRCode.toDataURL(paymentUrl, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    return qrDataUrl;
  } catch (error) {
    console.error('QR code generation error:', error);
    throw new Error('Failed to generate QR code');
  }
};

/**
 * A generated payment QR plus the SEP-0007 URI it was built from.
 *
 * encodesSep7Uri is false when the URI exceeded the QR payload budget and
 * the image encodes fallbackContent (the HTTPS pay link) instead.
 */
export interface StellarPaymentQR {
  qrDataUrl: string;
  uri: string;
  encodesSep7Uri: boolean;
}

/**
 * Generate Stellar payment QR (SEP-0007 format) with QR payload budget enforcement.
 *
 * @param destination - Destination Stellar public key.
 * @param amount - Payment amount as string.
 * @param assetCode - Asset code, defaults to XLM.
 * @param memo - Optional transaction memo.
 * @param assetIssuer - Optional issuer public key for non-native assets.
 * @param fallbackContent - Optional fallback link to encode when URI exceeds payload budget.
 * @returns Object with base64 QR data URL, full SEP-0007 URI, and whether QR encodes SEP-0007 URI.
 */
export const generateStellarPaymentQR = async (
  destination: string,
  amount: string,
  assetCode: string = 'XLM',
  memo?: string,
  assetIssuer?: string,
  fallbackContent?: string
): Promise<StellarPaymentQR> => {
  const { uri: stellarUri } = formatQrPaymentPayload({
    destination,
    amount,
    memo,
    asset:
      assetCode !== 'XLM' && assetIssuer
        ? { code: assetCode, issuer: assetIssuer }
        : undefined,
  });

  const encodesSep7Uri = fitsSep7QrBudget(stellarUri);
  const content = encodesSep7Uri ? stellarUri : fallbackContent;
  if (!content) {
    throw new Error('SEP-0007 URI exceeds the QR payload budget and no fallback link was provided');
  }

  const qrDataUrl = await QRCode.toDataURL(content, {
    errorCorrectionLevel: 'H',
    width: 400,
    margin: 1,
  });

  return { qrDataUrl, uri: stellarUri, encodesSep7Uri };
};

export default {
  generatePaymentQR,
  generateStellarPaymentQR,
};
