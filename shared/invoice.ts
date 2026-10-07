/**
 * The invoice DTO as it crosses the wire, shared by the backend API and the
 * Next.js client.
 *
 * Note the deliberate difference from the backend's internal
 * `services/invoice.service.ts` Invoice: that one carries Date objects
 * because it is what storage hands around, while JSON renders a Date as an
 * ISO-8601 string. The two are not interchangeable, and conflating them is how
 * a client ends up calling .getTime() on a string. This type describes the
 * response body a caller actually receives.
 */

export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

/** ISO-8601 timestamp, as produced by JSON serialisation of a Date. */
export type IsoTimestamp = string;

export interface InvoiceDto {
  id: string;
  sellerPublicKey: string;
  sellerName?: string;
  sellerEmail?: string;
  /** Decimal amount as a number in the current MVP contract. */
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  memo: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  status: InvoiceStatus;
  paymentTxHash?: string;
  payerPublicKey?: string;
  payerName?: string;
  payerEmail?: string;
  createdAt: IsoTimestamp;
  paidAt?: IsoTimestamp;
  expiresAt: IsoTimestamp;
  metadata?: unknown;
}

/**
 * The public pay DTO: what `GET /invoices/:id` returns to any caller that did
 * not authenticate as the invoice's seller (issue #503). The `/pay/[id]`
 * checkout page, the QR payload, and the verify response only ever need
 * these fields — client contact details, seller profile fields, payer
 * identity, and settlement internals are workspace-only.
 *
 * `PUBLIC_INVOICE_FIELDS` is the whitelist the serializer applies; the
 * contract test fails if a serialized response carries a key outside it, so
 * the two shapes cannot silently drift.
 */
export interface PublicInvoiceDto {
  id: string;
  sellerPublicKey: string;
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  memo: string;
  status: InvoiceStatus;
  paymentTxHash?: string;
  latePaymentWarningCode?: string;
  settlementContext?: string;
  priorStatus?: InvoiceStatus;
  createdAt: IsoTimestamp;
  paidAt?: IsoTimestamp;
  cancelledAt?: IsoTimestamp;
  settledAt?: IsoTimestamp;
  expiresAt: IsoTimestamp;
}

export const PUBLIC_INVOICE_FIELDS: ReadonlyArray<keyof PublicInvoiceDto> = [
  'id',
  'sellerPublicKey',
  'amount',
  'assetCode',
  'assetIssuer',
  'memo',
  'status',
  'paymentTxHash',
  'latePaymentWarningCode',
  'settlementContext',
  'priorStatus',
  'createdAt',
  'paidAt',
  'cancelledAt',
  'settledAt',
  'expiresAt',
];

/** Serializes a stored invoice down to the public pay shape. */
export function toPublicInvoiceDto(invoice: {
  id: string;
  sellerPublicKey: string;
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  memo: string;
  status: InvoiceStatus;
  paymentTxHash?: string;
  latePaymentWarningCode?: string;
  settlementContext?: string;
  priorStatus?: InvoiceStatus;
  createdAt: Date | IsoTimestamp;
  paidAt?: Date | IsoTimestamp;
  cancelledAt?: Date | IsoTimestamp;
  settledAt?: Date | IsoTimestamp;
  expiresAt: Date | IsoTimestamp;
}): PublicInvoiceDto {
  const iso = (v: Date | IsoTimestamp | undefined) =>
    v === undefined ? undefined : v instanceof Date ? v.toISOString() : v;
  return {
    id: invoice.id,
    sellerPublicKey: invoice.sellerPublicKey,
    amount: invoice.amount,
    assetCode: invoice.assetCode,
    assetIssuer: invoice.assetIssuer,
    memo: invoice.memo,
    status: invoice.status,
    paymentTxHash: invoice.paymentTxHash,
    latePaymentWarningCode: invoice.latePaymentWarningCode,
    settlementContext: invoice.settlementContext,
    priorStatus: invoice.priorStatus,
    createdAt: iso(invoice.createdAt) as IsoTimestamp,
    paidAt: iso(invoice.paidAt),
    cancelledAt: iso(invoice.cancelledAt),
    settledAt: iso(invoice.settledAt),
    expiresAt: iso(invoice.expiresAt) as IsoTimestamp,
  };
}


/**
 * Keys that must never appear on a public pay / verify / payment-info /
 * proof / mailto / log surface (issue #559). Seller workspace reads gated by
 * the invoice's Freighter wallet remain the only path that returns them.
 *
 * `PUBLIC_INVOICE_FIELDS` is the allowlist; this is the denylist of
 * identity-shaped keys the contract tests name so dropping one from the
 * allowlist (or adding one here without covering a surface) fails loudly.
 */
export const SELLER_ONLY_INVOICE_FIELDS = [
  'customerName',
  'customerEmail',
  'sellerName',
  'sellerEmail',
  'payerPublicKey',
  'payerName',
  'payerEmail',
  'description',
  'metadata',
  'userId',
] as const;

export type SellerOnlyInvoiceField = (typeof SELLER_ONLY_INVOICE_FIELDS)[number];

/** Identity-shaped key names redacted from events, proof bodies, and logs. */
export const IDENTITY_INVOICE_KEY_PATTERN =
  /memo|email|customername|payername|sellername|description|metadata|userid/i;

export function isSellerOnlyInvoiceField(key: string): boolean {
  return (SELLER_ONLY_INVOICE_FIELDS as readonly string[]).includes(key);
}

export function isPublicInvoiceField(key: string): boolean {
  return (PUBLIC_INVOICE_FIELDS as readonly string[]).includes(key);
}

/**
 * Drop seller-only / identity-shaped keys from an arbitrary payload.
 * Used by proof HTML, mailto bodies, and any surface that might be handed a
 * full workspace invoice by mistake.
 */
export function omitSellerOnlyFields<T extends Record<string, unknown>>(
  input: T
): Omit<T, SellerOnlyInvoiceField> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (isSellerOnlyInvoiceField(key)) continue;
    out[key] = value;
  }
  return out as Omit<T, SellerOnlyInvoiceField>;
}
