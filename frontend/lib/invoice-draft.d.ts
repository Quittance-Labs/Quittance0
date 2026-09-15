export const INVOICE_DRAFT_STORAGE_KEY: string;

export interface InvoiceDraft {
  amount?: string;
  assetCode?: string;
  description?: string;
  sellerName?: string;
  sellerEmail?: string;
  customerName?: string;
  customerEmail?: string;
  expiresInDays?: number;
}

export function saveInvoiceDraft(draft: InvoiceDraft): void;
export function loadInvoiceDraft(): InvoiceDraft | null;
export function clearInvoiceDraft(): void;
