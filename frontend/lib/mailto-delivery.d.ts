export interface InvoiceMailtoInput {
  id: string;
  amount: number | string;
  assetCode?: string;
  assetIssuer?: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  sellerName?: string;
  sellerEmail?: string;
  payerName?: string;
  payerEmail?: string;
  status: string;
  createdAt?: string;
  expiresAt?: string;
  paidAt?: string;
  memo?: string;
  sellerPublicKey?: string;
  payerPublicKey?: string;
  paymentTxHash?: string;
}

export function isValidEmailFormat(email?: string | null): boolean;
export function resolvePayUrl(invoiceId: string, baseUrl?: string): string;
export function canSendInvoiceEmail(invoice?: InvoiceMailtoInput | null): boolean;
export function getInvoiceMailtoRecipient(invoice?: InvoiceMailtoInput | null): string;
export function canSendProofEmail(invoice?: InvoiceMailtoInput | null): boolean;
export function getProofMailtoRecipient(invoice?: InvoiceMailtoInput | null): string;
export function buildInvoiceMailto(invoice: InvoiceMailtoInput, baseUrl?: string): string;
export function buildProofMailto(invoice: InvoiceMailtoInput, baseUrl?: string): string;
export function openInvoiceMailto(invoice: InvoiceMailtoInput, baseUrl?: string): string;
export function openProofMailto(invoice: InvoiceMailtoInput, baseUrl?: string): string;
