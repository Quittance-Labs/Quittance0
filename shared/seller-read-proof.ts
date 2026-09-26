/** A short-lived proof that the connected Freighter wallet owns seller reads. */
export const SELLER_READ_MAX_AGE_MS = 60_000;
export const SELLER_READ_CLOCK_SKEW_MS = 5_000;

/** Keep the signed bytes identical on the browser and both server backends. */
export function sellerReadMessage(scope: string, sellerPublicKey: string, signedAt: string): string {
  return `quittance:seller-read:v1:${scope}:${sellerPublicKey}:${signedAt}`;
}
