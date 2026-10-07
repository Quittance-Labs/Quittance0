/** A short-lived proof that the connected Freighter wallet owns seller reads. */
export const SELLER_READ_MAX_AGE_MS = 60_000;
export const SELLER_READ_CLOCK_SKEW_MS = 5_000;

/**
 * One signature per wallet session (issue #586's direction): the dashboard's
 * list, stats, detail and events reads share a single signed proof instead of
 * prompting per route every minute. A session-scoped signature is honoured by
 * every seller read for up to one hour; a route-scoped signature still covers
 * only its own scope for 60 seconds.
 */
export const SELLER_SESSION_SCOPE = 'session';
export const SELLER_SESSION_MAX_AGE_MS = 3_600_000;

/** Keep the signed bytes identical on the browser and both server backends. */
export function sellerReadMessage(scope: string, sellerPublicKey: string, signedAt: string): string {
  return `quittance:seller-read:v1:${scope}:${sellerPublicKey}:${signedAt}`;
}
