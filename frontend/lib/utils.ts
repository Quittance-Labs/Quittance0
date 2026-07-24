import { type ClassValue, clsx } from 'clsx';

/**
 * Merge class names
 */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

/**
 * Format amount with proper decimals
 */
export function formatAmount(amount: number | string, decimals: number = 2): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format Stellar address (shorten)
 */
export function formatAddress(address: string, chars: number = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Copy to clipboard
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy:', error);
    return false;
  }
}

/**
 * Format date
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Calculate time remaining
 */
export function getTimeRemaining(expiresAt: string | Date): string {
  const now = new Date().getTime();
  const expiry = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt.getTime();
  const diff = expiry - now;

  if (diff <= 0) return 'Expired';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Generate share URL
 */
export function getShareUrl(invoiceId: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${baseUrl}/pay/${invoiceId}`;
}

/**
 * Get status color
 */
export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'paid':
      return 'text-green-600 bg-green-50';
    case 'pending':
      return 'text-yellow-600 bg-yellow-50';
    case 'expired':
      return 'text-red-600 bg-red-50';
    case 'cancelled':
      return 'text-gray-600 bg-gray-50';
    default:
      return 'text-gray-600 bg-gray-50';
  }
}

/**
 * Invoice status union — exported for documentation and IDE hover-hint
 * at call sites. Tightening `interactiveStatus`'s parameter (and the
 * `Invoice` interfaces in components / page state) to this union is a
 * follow-up that touches each call site — see issue #19 design proposal.
 */
export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

/**
 * Common invoice fields, shared between PAID and non-PAID variants.
 * Internal to `@/lib/utils`; components/pages should bind to the
 * `Invoice` discriminated union exported below.
 */
interface InvoiceCommon {
  id: string;
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  createdAt: string;
  expiresAt: string;
  memo: string;
  sellerPublicKey: string;
  sellerName?: string;
  sellerEmail?: string;
  payerPublicKey?: string;
  payerName?: string;
  payerEmail?: string;
  paymentTxHash?: string;
}

/**
 * Frontend `Invoice` shape — discriminated union over `status`. Mirrors
 * the in-memory invoice object returned by the MVP backend
 * (`backend/src/services/invoice-memory.service.ts`). `status` is typed
 * as `InvoiceStatus`; adding a new value is a deliberate union extension
 * that `tsc` will surface at every consumer.
 *
 * Field rules:
 *   - When `status === 'PAID'`, `paidAt: string` is required (matches
 *     the backend `markAsPaid` invariant: status flips to PAID *together*
 *     with `paid_at = NOW()` in a single SQL UPDATE).
 *   - Otherwise `paidAt` is `never`, so a non-PAID read is a compile
 *     error rather than a runtime `undefined` trap.
 *
 * TypeScript narrows on a `status === 'PAID'` discriminator:
 * ```
 * if (invoice.status === 'PAID') {
 *   formatDate(invoice.paidAt);  // string, no `!` needed
 * }
 * ```
 *
 * Consumers that gate on `status` with a JSX `&&` do NOT auto-narrow
 * inside the JSX subtree; use `cond ? <jsx /> : null` or pre-compute a
 * narrowed local to get the inference to flow.
 */
export type Invoice =
  | (InvoiceCommon & { status: 'PAID'; paidAt: string })
  | (InvoiceCommon & {
      status: 'PENDING' | 'EXPIRED' | 'CANCELLED';
      paidAt?: never;
    });

/**
 * Returns true if interactive payment controls (QR, Pay button, copy link)
 * should be rendered for the given invoice status. Single source of truth
 * for `#19` ("Hide QR and Pay controls on EXPIRED invoices only").
 *
 * Contract: show iff status === 'PENDING'.
 *
 * The parameter is `InvoiceStatus`. Adding a new status is a deliberate
 * union extension: `tsc` will then surface every switch / helper / call
 * site that needs handling, and `interactiveStatus` continues to return
 * `false` for any non-PENDING union member. The previous runtime
 * fallback to `false` for unknown strings is intentionally gone — tsc is
 * the guard now.
 */
export function interactiveStatus(status: InvoiceStatus): boolean {
  return status === 'PENDING';
}

/**
 * Validate email
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Format currency
 */
export function formatCurrency(amount: number, currency: string = 'XLM'): string {
  return `${formatAmount(amount, 7)} ${currency}`;
}

export default {
  cn,
  formatAmount,
  formatAddress,
  copyToClipboard,
  formatDate,
  getTimeRemaining,
  getShareUrl,
  getStatusColor,
  interactiveStatus,
  isValidEmail,
  formatCurrency,
};

