import type { QuittanceProof } from './quittance-proof';

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
  network?: string | null;
}

export function isValidEmailFormat(email?: string | null): boolean;
export function resolvePayUrl(invoiceId: string, baseUrl?: string): string;
export function resolveInvoiceNetwork(invoice?: { network?: string | null } | null): 'testnet' | 'public';
export function canSendInvoiceEmail(invoice?: InvoiceMailtoInput | null): boolean;
export function getInvoiceMailtoRecipient(invoice?: InvoiceMailtoInput | null): string;
export function canSendProofEmail(invoice?: InvoiceMailtoInput | null): boolean;
export function getProofMailtoRecipient(invoice?: InvoiceMailtoInput | null): string;
export function buildInvoiceMailto(invoice: InvoiceMailtoInput, baseUrl?: string): string;
export function buildProofMailto(
  invoiceOrProof: InvoiceMailtoInput | QuittanceProof,
  baseUrl?: string,
  recipientOverride?: string
): string;
export function openInvoiceMailto(invoice: InvoiceMailtoInput, baseUrl?: string): string;
export function openProofMailto(
  invoiceOrProof: InvoiceMailtoInput | QuittanceProof,
  baseUrl?: string,
  recipientOverride?: string
): string;
