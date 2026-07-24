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
 * Per-status meta for the `<StatusBadge>` component. Single source of
 * truth for both rendering variants (`badge` — dot + friendly label
 * for the pay-page header, and `chip` — bg+text-pill for the
 * dashboard `<InvoiceCard>`). Typed as `Record<InvoiceStatus, …>` so
 * adding a new status surfaces at every consumer via `tsc` — no
 * missing-key silent fallback.
 *
 * Shape per status:
 *   - `dotClassName`     — the badge variant's pulsing/solid dot.
 *   - `labelClassName`   — the badge variant's <span> text styling.
 *   - `label`            — friendly text for the badge variant
 *                          (e.g. "Waiting for Payment" not "PENDING").
 *   - `chipClassName`    — the chip variant's bg + text-color combo.
 *   - `chipLabel`        — literal uppercase status text for chip
 *                          (e.g. "PENDING"). Mirrors `invoice.status`.
 * Both variants are defined for every status so the union is exhaustive
 * and consumers can switch between badge and chip freely.
 */
export const STATUS_META: Record<
  InvoiceStatus,
  { dotClassName: string; labelClassName: string; label: string; chipClassName: string; chipLabel: string }
> = {
  PENDING: {
    dotClassName: 'w-2 h-2 bg-yellow-500 rounded-full animate-pulse',
    labelClassName: 'text-yellow-700 font-semibold',
    label: 'Waiting for Payment',
    chipClassName: 'text-yellow-600 bg-yellow-50',
    chipLabel: 'PENDING',
  },
  PAID: {
    dotClassName: 'w-2 h-2 bg-green-500 rounded-full',
    labelClassName: 'text-green-700 font-semibold',
    label: 'Paid',
    chipClassName: 'text-green-600 bg-green-50',
    chipLabel: 'PAID',
  },
  EXPIRED: {
    dotClassName: 'w-2 h-2 bg-red-500 rounded-full',
    labelClassName: 'text-red-700 font-semibold',
    label: 'Expired',
    chipClassName: 'text-red-600 bg-red-50',
    chipLabel: 'EXPIRED',
  },
  CANCELLED: {
    dotClassName: 'w-2 h-2 bg-gray-500 rounded-full',
    labelClassName: 'text-gray-700 font-semibold',
    label: 'Cancelled',
    chipClassName: 'text-gray-600 bg-gray-50',
    chipLabel: 'CANCELLED',
  },
};

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
 *
 * `paymentTxHash` and `payerPublicKey` are NOT on this base — they
 * discriminate the PAID variant of `Invoice` (Option B), so reading
 * them on a non-PAID invoice is a compile error.
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
  payerName?: string;
  payerEmail?: string;
}

/**
 * Frontend `Invoice` shape — discriminated union over `status`. Mirrors
 * the in-memory invoice object returned by the MVP backend
 * (`backend/src/services/invoice-memory.service.ts`). `status` is typed
 * as `InvoiceStatus`; adding a new value is a deliberate union extension
 * that `tsc` will surface at every consumer.
 *
 * Field rules (Option B — atomic backend invariant):
 *   - When `status === 'PAID'`, three fields become required:
 *     `paidAt: string`, `paymentTxHash: string`, `payerPublicKey: string`.
 *     Matches the backend `markAsPaid` invariant: status flips to PAID
 *     together with `paid_at = NOW()`, `payment_tx_hash = $2`, and
 *     `payer_public_key = $3` in a single SQL UPDATE — a PAID invoice
 *     without any of those three is structurally impossible.
 *   - Otherwise all three are `never`, so a non-PAID read is a compile
 *     error rather than a runtime `undefined` trap.
 *
 * TypeScript narrows on a `status === 'PAID'` discriminator:
 * ```
 * if (invoice.status === 'PAID') {
 *   formatDate(invoice.paidAt);          // string
 *   console.log(invoice.paymentTxHash);  // string
 *   console.log(invoice.payerPublicKey); // string
 * }
 * ```
 *
 * Consumers that gate on `status` with a JSX `&&` do NOT auto-narrow
 * inside the JSX subtree; use `cond ? <jsx /> : null` or pre-compute a
 * narrowed local to get the inference to flow.
 */
export type Invoice =
  | (InvoiceCommon & {
      status: 'PAID';
      paidAt: string;
      paymentTxHash: string;
      payerPublicKey: string;
    })
  | (InvoiceCommon & {
      status: 'PENDING' | 'EXPIRED' | 'CANCELLED';
      paidAt?: never;
      paymentTxHash?: never;
      payerPublicKey?: never;
    });

/**
 * Common envelope for every Quittance0 backend endpoint response.
 * Mirrors the shape produced by `backend/src/controllers/invoice.controller.ts`:
 * `{ success: true, data: T, pagination?: {...} }` on success and
 * `{ success: false, error: string }` on error. Typed here so the
 * frontend `lib/api.ts` retype stays a mechanical, single-value
 * exercise instead of inventing structures ad hoc per endpoint.
 *
 * `T` is the payload the consumer cares about (the `.data` field).
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  pagination?: {
    limit: number;
    offset: number;
    total: number;
  };
}

/**
 * Response from POST /invoices (create) and GET /invoices/:id/payment-info.
 * The two endpoints are structurally identical — both return the freshly
 * created (or freshly loaded) invoice plus its shareable payment surface.
 * Mirrors `backend/src/controllers/invoice.controller.ts`:
 *   - `createInvoice`: `{ invoice, paymentUrl, qrCode, stellarQrCode }`
 *   - `getPaymentInfo`: `{ invoice, paymentUrl, qrCode, stellarQrCode }`
 */
export interface PaymentSession {
  invoice: Invoice;
  paymentUrl: string;
  qrCode: string;
  stellarQrCode: string;
}

/**
 * Per-asset aggregate row returned by GET /invoices/stats.
 * The backend query (`backend/src/services/invoice.service.ts:228-247`)
 * SELECTs `COUNT(*) ... SUM(CASE WHEN ...) ... GROUP BY asset_code`, so
 * `total_invoices`, `paid_invoices`, `pending_invoices`,
 * `expired_invoices`, and `total_revenue` arrive as **strings** from
 * node-postgres by default (BigInt-supporting drivers can return string).
 * The shape is kept as `string | number` so any future conversion at
 * the SQL layer doesn't force re-typing this struct.
 */
export interface InvoiceStats {
  total_invoices: string | number;
  paid_invoices: string | number;
  pending_invoices: string | number;
  expired_invoices: string | number;
  total_revenue: string | number;
  asset_code: string;
}

/**
 * Frontend-side input shape for POST /invoices. Mirrors the backend's
 * `CreateInvoiceInput` (`backend/src/utils/validation.ts`). Kept here
 * as the canonical frontend view so `lib/api.ts` doesn't have to
 * duplicate the field list.
 */
export interface CreateInvoiceInput {
  amount: number;
  assetCode?: string;
  assetIssuer?: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  expiresInDays?: number;
  sellerPublicKey?: string;
  sellerName?: string;
  sellerEmail?: string;
}

/**
 * Frontend-side input shape for POST /invoices/:id/verify.
 */
export interface VerifyInvoiceInput {
  txHash: string;
  payerPublicKey?: string;
  payerName?: string;
  payerEmail?: string;
}

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
 * Returns true if the invoice is in a fully paid state. Single source of
 * truth for #19 followup #3 — the boolean complement of `interactiveStatus`.
 * Mirrors the backend `markAsPaid` invariant: when this returns true,
 * `paidAt`, `paymentTxHash`, and `payerPublicKey` are non-undefined strings
 * on the discriminated union in `Invoice` (Option B).
 *
 * Use this in:
 *   - filter ops (`invoices.filter(inv => paymentCompleted(inv.status))`)
 *   - boolean gates that don't need PAID-field narrowing
 *     (`{paymentCompleted(invoice.status) && <PostPaidButtonMount />}`)
 *   - non-narrowing status checks (e.g. menu items, dashboard counts)
 *
 * Do NOT use as a discriminator when reading PAID-specific fields
 * (`paidAt`, `paymentTxHash`, `payerPublicKey`); the helper returns
 * `boolean`, so it loses the discriminated-union narrow. Use the raw
 * `invoice.status === 'PAID'` ternary for those.
 */
export function paymentCompleted(status: InvoiceStatus): boolean {
  return status === 'PAID';
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
  interactiveStatus,
  isValidEmail,
  formatCurrency,
};

