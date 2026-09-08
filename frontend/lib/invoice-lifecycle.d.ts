export interface InvoiceLifecycleInput {
  status?: string;
  expiresAt?: string | Date;
  paymentTxHash?: string | null;
}

export function expiryTimestamp(expiresAt?: string | Date): number | null;
export function hasInvoiceExpired(invoice?: InvoiceLifecycleInput | null, now?: string | number | Date): boolean;
export function effectiveInvoiceStatus(invoice?: InvoiceLifecycleInput | null, now?: string | number | Date): string | undefined;
export function applyExpiryStatus<T extends InvoiceLifecycleInput>(invoice: T, now?: string | number | Date): T;
export function applyExpiryLifecycle<T extends InvoiceLifecycleInput>(invoices: T[], now?: string | number | Date): T[];
export function isActionableInvoice(invoice?: InvoiceLifecycleInput | null, now?: string | number | Date): boolean;
