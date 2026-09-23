import { createHash } from 'crypto';
import type { CreateInvoiceInput } from './validation';

export const IDEMPOTENT_CREATE_WINDOW_MS = 120_000;

const normalizeField = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

/**
 * Computes a deterministic canonical signature for an invoice creation intent.
 *
 * @param input - The validated invoice creation payload.
 * @returns A string signature combining core intent fields.
 */
function createSignature(input: CreateInvoiceInput): string {
  return [
    input.sellerPublicKey,
    input.amount.toFixed(7),
    (input.assetCode || 'XLM').toUpperCase(),
    input.assetIssuer ?? '',
    normalizeField(input.description),
    normalizeField(input.customerName),
    normalizeField(input.customerEmail),
    String(input.expiresInDays),
  ].join('|');
}

/**
 * Derives the storage deduplication key for an invoice creation request.
 *
 * If the input already contains an explicit idempotencyKey (e.g. from header or body),
 * that key is returned directly. Otherwise, derives a deterministic bucketed hash
 * from the intent signature and current time window.
 *
 * @param input - The validated invoice creation payload.
 * @param now - Optional timestamp used to determine the time bucket.
 * @returns The unique idempotency key string.
 */
export function idempotencyKeyForCreate(
  input: CreateInvoiceInput,
  now: number = Date.now()
): string {
  if (input.idempotencyKey) {
    return input.idempotencyKey;
  }
  const bucket = Math.floor(now / IDEMPOTENT_CREATE_WINDOW_MS);
  const hash = createHash('sha256')
    .update(`${createSignature(input)}|${bucket}`)
    .digest('hex')
    .slice(0, 48);
  return `sig:${hash}`;
}
