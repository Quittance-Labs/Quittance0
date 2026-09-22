/**
 * Shared invoice DTOs and mappers across the backend and frontend.
 *
 * Provides two distinct response shapes:
 * 1. PublicInvoiceDto: Served to public payers and unauthenticated readers.
 *    Excludes client contact details and seller-only metadata.
 * 2. SellerInvoiceDto: Served to the owning seller wallet.
 *    Includes client contact information and workspace internals.
 */

export type InvoiceStatus = 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';

/** ISO-8601 timestamp string produced by Date JSON serialization. */
export type IsoTimestamp = string;

/**
 * Public payment DTO for payers and unauthenticated client views.
 * Contains only data necessary to display, render QR codes, and settle payments.
 */
export interface PublicInvoiceDto {
  id: string;
  sellerPublicKey: string;
  destination: string;
  amount: number;
  assetCode: string;
  assetIssuer?: string;
  memo: string;
  description?: string;
  sellerName?: string;
  status: InvoiceStatus;
  createdAt: IsoTimestamp;
  expiresAt: IsoTimestamp;
  paidAt?: IsoTimestamp;
  cancelledAt?: IsoTimestamp;
  settledAt?: IsoTimestamp;
  settlementContext?: 'ON_TIME' | 'AFTER_EXPIRY' | 'AFTER_CANCEL';
  priorStatus?: InvoiceStatus;
  latePaymentWarningCode?: 'PAYMENT_RECEIVED_AFTER_EXPIRY' | 'PAYMENT_RECEIVED_AFTER_CANCEL';
  paymentTxHash?: string;
  payerPublicKey?: string;
  paymentUri?: string;
}

/**
 * Seller workspace DTO for the invoice owner.
 * Extends the public DTO with client contact details and seller notes.
 */
export interface SellerInvoiceDto extends PublicInvoiceDto {
  customerName?: string;
  customerEmail?: string;
  sellerEmail?: string;
  payerName?: string;
  payerEmail?: string;
  metadata?: unknown;
}

export type InvoiceDto = SellerInvoiceDto;
export type PublicInvoiceDTO = PublicInvoiceDto;
export type SellerInvoiceDTO = SellerInvoiceDto;

export const PUBLIC_INVOICE_FIELDS = [
  'id',
  'sellerPublicKey',
  'destination',
  'amount',
  'assetCode',
  'assetIssuer',
  'memo',
  'description',
  'sellerName',
  'status',
  'createdAt',
  'expiresAt',
  'paidAt',
  'cancelledAt',
  'settledAt',
  'settlementContext',
  'priorStatus',
  'latePaymentWarningCode',
  'paymentTxHash',
  'payerPublicKey',
  'paymentUri',
] as const;

export const SELLER_ONLY_FIELDS = [
  'customerName',
  'customerEmail',
  'sellerEmail',
  'payerName',
  'payerEmail',
  'metadata',
] as const;

export const SELLER_INVOICE_FIELDS = [
  ...PUBLIC_INVOICE_FIELDS,
  ...SELLER_ONLY_FIELDS,
] as const;

/**
 * Builds a standards-compliant SEP-0007 payment URI (web+stellar:pay).
 */
export function buildSep0007PayUri(params: {
  destination: string;
  amount: number | string;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
}): string {
  const dest = (params.destination || '').trim();
  const searchParams = new URLSearchParams();
  searchParams.set('destination', dest);

  const amountStr = String(params.amount ?? '').trim();
  if (amountStr !== '') {
    searchParams.set('amount', amountStr);
  }

  const assetCode = (params.assetCode || '').trim().toUpperCase();
  if (assetCode && assetCode !== 'XLM') {
    searchParams.set('asset_code', assetCode);
    if (params.assetIssuer && params.assetIssuer.trim() !== '') {
      searchParams.set('asset_issuer', params.assetIssuer.trim());
    }
  }

  if (params.memo && params.memo.trim() !== '') {
    searchParams.set('memo', params.memo.trim());
    searchParams.set('memo_type', 'MEMO_TEXT');
  }

  return `web+stellar:pay?${searchParams.toString()}`;
}

function toIsoTimestamp(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

/**
 * Maps a stored record or raw invoice object to a clean PublicInvoiceDto.
 * Excludes customer contact information and internal seller metadata.
 */
export function toPublicInvoiceDto(raw: any): PublicInvoiceDto {
  const sellerPublicKey = String(raw.sellerPublicKey || raw.destination || '');
  const destination = sellerPublicKey;
  const amount = Number(raw.amount);
  const assetCode = (raw.assetCode || 'XLM').toUpperCase();
  const memo = String(raw.memo || '');

  const paymentUri =
    typeof raw.paymentUri === 'string' && raw.paymentUri
      ? raw.paymentUri
      : sellerPublicKey
      ? buildSep0007PayUri({
          destination: sellerPublicKey,
          amount,
          assetCode,
          assetIssuer: raw.assetIssuer,
          memo,
        })
      : undefined;

  const dto: PublicInvoiceDto = {
    id: String(raw.id),
    sellerPublicKey,
    destination,
    amount,
    assetCode,
    memo,
    status: raw.status,
    createdAt: toIsoTimestamp(raw.createdAt) || new Date().toISOString(),
    expiresAt: toIsoTimestamp(raw.expiresAt) || new Date().toISOString(),
  };

  if (raw.assetIssuer !== undefined && raw.assetIssuer !== null && raw.assetIssuer !== '') {
    dto.assetIssuer = String(raw.assetIssuer);
  }
  if (raw.description !== undefined && raw.description !== null && raw.description !== '') {
    dto.description = String(raw.description);
  }
  if (raw.sellerName !== undefined && raw.sellerName !== null && raw.sellerName !== '') {
    dto.sellerName = String(raw.sellerName);
  }
  if (raw.paidAt) {
    dto.paidAt = toIsoTimestamp(raw.paidAt);
  }
  if (raw.cancelledAt) {
    dto.cancelledAt = toIsoTimestamp(raw.cancelledAt);
  }
  if (raw.settledAt) {
    dto.settledAt = toIsoTimestamp(raw.settledAt);
  }
  if (raw.settlementContext) {
    dto.settlementContext = raw.settlementContext;
  }
  if (raw.priorStatus) {
    dto.priorStatus = raw.priorStatus;
  }
  if (raw.latePaymentWarningCode) {
    dto.latePaymentWarningCode = raw.latePaymentWarningCode;
  }
  if (raw.paymentTxHash) {
    dto.paymentTxHash = String(raw.paymentTxHash);
  }
  if (raw.payerPublicKey) {
    dto.payerPublicKey = String(raw.payerPublicKey);
  }
  if (paymentUri) {
    dto.paymentUri = paymentUri;
  }

  return dto;
}

/**
 * Maps a stored record or raw invoice object to a full SellerInvoiceDto.
 * Preserves customer contact information and seller notes for authorized seller views.
 */
export function toSellerInvoiceDto(raw: any): SellerInvoiceDto {
  const publicDto = toPublicInvoiceDto(raw);
  const dto: SellerInvoiceDto = {
    ...publicDto,
  };

  if (raw.customerName !== undefined && raw.customerName !== null && raw.customerName !== '') {
    dto.customerName = String(raw.customerName);
  }
  if (raw.customerEmail !== undefined && raw.customerEmail !== null && raw.customerEmail !== '') {
    dto.customerEmail = String(raw.customerEmail);
  }
  if (raw.sellerEmail !== undefined && raw.sellerEmail !== null && raw.sellerEmail !== '') {
    dto.sellerEmail = String(raw.sellerEmail);
  }
  if (raw.payerName !== undefined && raw.payerName !== null && raw.payerName !== '') {
    dto.payerName = String(raw.payerName);
  }
  if (raw.payerEmail !== undefined && raw.payerEmail !== null && raw.payerEmail !== '') {
    dto.payerEmail = String(raw.payerEmail);
  }
  if (raw.metadata !== undefined && raw.metadata !== null) {
    dto.metadata = raw.metadata;
  }

  return dto;
}
