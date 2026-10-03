import { emitOperationalFailure } from '../observability/log-events';
import QRCode from 'qrcode';
import { formatQrPaymentPayload } from './qr-payment-payload';
import { fitsSep7QrBudget } from './qr-budget';

/**
 * Generate QR code for payment URL
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
    emitOperationalFailure('qr.generate');
    throw new Error('Failed to generate QR code');
  }
};

/**
 * A generated payment QR plus the SEP-0007 URI it was built from.
 *
 * `encodesSep7Uri` is false when the URI exceeded the QR payload budget and
 * the image encodes `fallbackContent` (the HTTPS pay link) instead — the full
 * URI stays available on `uri` for copy / open-in-wallet.
 */
export interface StellarPaymentQR {
  qrDataUrl: string;
  uri: string;
  encodesSep7Uri: boolean;
}

/**
 * Generate Stellar payment QR (SEP-0007 format)
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

  // An over-budget URI produces a dense QR that phone cameras miss; encode the
  // short HTTPS pay link instead and let the caller expose the full URI as
  // copyable text. Memo and issuer are never truncated to shrink the QR.
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
