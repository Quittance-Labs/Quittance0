import QRCode from 'qrcode';
import { formatQrPaymentPayload } from './qr-payment-payload';

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
    console.error('QR code generation error:', error);
    throw new Error('Failed to generate QR code');
  }
};

/**
 * Generate Stellar payment QR (SEP-0007 format)
 */
export const generateStellarPaymentQR = async (
  destination: string,
  amount: string,
  assetCode: string = 'XLM',
  memo?: string,
  assetIssuer?: string
): Promise<string> => {
  const stellarUri = formatQrPaymentPayload({
    destination,
    amount,
    assetCode,
    memo,
    assetIssuer,
  });

  return await QRCode.toDataURL(stellarUri, {
    errorCorrectionLevel: 'H',
    width: 400,
    margin: 1,
  });
};

export default {
  generatePaymentQR,
  generateStellarPaymentQR,
};

