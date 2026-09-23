import QRCode from 'qrcode';

/**
 * QR payload budget for SEP-0007 payment URIs (issue #510).
 *
 * Dense QRs fail on mobile cameras even when the URI is spec-valid: the pay
 * page renders the code at ~220px, so each module drops below ~3px once the
 * version grows past ~12. The budget caps the encoded URI at QR version 12
 * under error-correction level H (~175 byte-mode bytes). An XLM invoice with a
 * memo fits this budget, while a USDC URI with code + issuer + memo exceeds it.
 *
 * When a URI is over budget, the QR must fall back to the short HTTPS pay link
 * rather than a truncated memo or dropped asset issuer.
 */
export const SEP7_QR_MAX_VERSION = 12;

/**
 * Calculates the minimal QR version required to encode text under error-correction level H.
 *
 * @param text - Payload text to evaluate.
 * @returns QR version number required for encoding.
 */
export const qrVersionFor = (text: string): number =>
  QRCode.create(text, { errorCorrectionLevel: 'H' }).version;

/**
 * Determines whether a SEP-0007 URI stays inside the scannable QR payload budget.
 *
 * @param uri - Full SEP-0007 URI string to test.
 * @returns True if URI fits within the version 12 budget, false otherwise.
 */
export const fitsSep7QrBudget = (uri: string): boolean =>
  qrVersionFor(uri) <= SEP7_QR_MAX_VERSION;
