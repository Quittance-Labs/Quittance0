/**
 * One pay-link artifact for the HTTPS link, the SEP-0007 URI, and the QR image
 * (issue #557).
 *
 * Create, the pay page, and the seller invoice page used to assemble these
 * three pieces independently. Amount formatting, memo checks, network, and the
 * QR size budget can still disagree across surfaces when each rebuilds its own
 * URI. This module builds them once and returns the same strings everywhere.
 */
import { STELLAR_NETWORK } from '../config/stellar';
import {
  passphraseFor,
  type StellarNetwork,
} from '../../../shared/network';
import { canonicalAmount } from './safe-amount-compare';
import { generatePaymentQR, generateStellarPaymentQR } from './qrcode';

/**
 * The single pay-link payload every surface renders.
 *
 * `copyValue` is whatever the QR image encoded — the SEP-0007 URI when it fit
 * the budget, otherwise the HTTPS pay link — so create, the pay page, and the
 * seller copy action cannot disagree about what scanning the code does.
 */
export interface PayLinkArtifact {
  paymentUrl: string;
  stellarUri: string;
  /** PNG data URL of the QR image. */
  qrDataUrl: string;
  /** True when the QR encodes `stellarUri`; false when it encodes `paymentUrl`. */
  encodesSep7Uri: boolean;
  /** The string the QR decided — same value create / pay / seller copy use. */
  copyValue: string;
  /** Passphrase from the same resolver explorer links use (issue #511). */
  networkPassphrase: string;
  network: StellarNetwork;
}

export interface BuildPayLinkArtifactInput {
  invoiceId: string;
  frontendUrl: string;
  destination: string;
  /** Raw invoice amount — formatted through the stroop helper before the URI. */
  amount: string | number;
  assetCode?: string;
  assetIssuer?: string | null;
  memo?: string | null;
  /**
   * Optional override for tests. Production always uses the process-resolved
   * STELLAR_NETWORK so the URI cannot drift from explorer links.
   */
  network?: StellarNetwork;
}

/**
 * Build the HTTPS pay URL, SEP-0007 URI, and QR decision as one artifact.
 *
 * Memo over 28 UTF-8 bytes is refused inside the URI formatter before any QR
 * work starts. Amounts go through `canonicalAmount` so a one-stroop value never
 * becomes `1e-7` in the URI.
 */
export async function buildPayLinkArtifact(
  input: BuildPayLinkArtifactInput,
): Promise<PayLinkArtifact> {
  const base = input.frontendUrl.replace(/\/$/, '');
  const paymentUrl = `${base}/pay/${input.invoiceId}`;
  const network = input.network ?? STELLAR_NETWORK;
  const networkPassphrase = passphraseFor(network);
  const amount =
    canonicalAmount(input.amount) ??
    (typeof input.amount === 'string' ? input.amount : String(input.amount));
  const assetCode = input.assetCode || 'XLM';

  const stellarPayment = await generateStellarPaymentQR(
    input.destination,
    amount,
    assetCode,
    input.memo || undefined,
    input.assetIssuer || undefined,
    paymentUrl,
    network,
  );

  const copyValue = stellarPayment.encodesSep7Uri
    ? stellarPayment.uri
    : paymentUrl;

  return {
    paymentUrl,
    stellarUri: stellarPayment.uri,
    qrDataUrl: stellarPayment.qrDataUrl,
    encodesSep7Uri: stellarPayment.encodesSep7Uri,
    copyValue,
    networkPassphrase,
    network,
  };
}

/**
 * Also emit a plain HTTPS QR for callers that still want a camera-app-friendly
 * code beside the Stellar one (create response `qrCode` field).
 */
export async function buildHttpsPayQr(paymentUrl: string): Promise<string> {
  return generatePaymentQR(paymentUrl);
}

export default {
  buildPayLinkArtifact,
  buildHttpsPayQr,
};
