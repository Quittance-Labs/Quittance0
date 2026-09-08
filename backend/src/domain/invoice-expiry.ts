export const MIN_INVOICE_EXPIRY_DAYS = 1;
export const MAX_INVOICE_EXPIRY_DAYS = 30;
export const DEFAULT_INVOICE_EXPIRY_DAYS = 7;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** Keep every invoice creation path on the same, bounded expiry contract. */
export function validateInvoiceExpiryDays(value: unknown): number {
  const days = value ?? DEFAULT_INVOICE_EXPIRY_DAYS;

  if (
    typeof days !== 'number' ||
    !Number.isInteger(days) ||
    days < MIN_INVOICE_EXPIRY_DAYS ||
    days > MAX_INVOICE_EXPIRY_DAYS
  ) {
    throw new RangeError(
      `Invoice expiry must be an integer between ${MIN_INVOICE_EXPIRY_DAYS} and ${MAX_INVOICE_EXPIRY_DAYS} days`
    );
  }

  return days;
}

export function calculateInvoiceExpiry(
  expiresInDays: unknown,
  now: Date = new Date()
): Date {
  return new Date(now.getTime() + validateInvoiceExpiryDays(expiresInDays) * DAY_IN_MS);
}

export function isPendingInvoiceExpired(
  invoice: { status: string; expiresAt: Date | string },
  now: Date = new Date()
): boolean {
  const expiresAt = new Date(invoice.expiresAt).getTime();
  return invoice.status === 'PENDING' && Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}
