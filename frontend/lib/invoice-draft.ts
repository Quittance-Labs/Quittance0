/**
 * Invoice create draft storage (Issue #432).
 *
 * Persists non-secret invoice creation fields in sessionStorage so that
 * temporary wallet disconnects, extensions locking, or accidental page reloads
 * do not cause users to lose their entered draft.
 *
 * Excludes private keys, secrets, and auth tokens.
 */

export const INVOICE_DRAFT_STORAGE_KEY = 'quittance_invoice_create_draft_v1';

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

const safeSessionStorage = (): Storage | null => {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      return window.sessionStorage;
    }
  } catch {
    // Storage access may throw in restricted iframes or disabled cookies
  }
  return null;
};

export function saveInvoiceDraft(draft: InvoiceDraft): void {
  const storage = safeSessionStorage();
  if (!storage) return;

  try {
    // Only persist defined, trimmed strings or numbers
    const cleanDraft: InvoiceDraft = {};
    if (typeof draft.amount === 'string' && draft.amount.trim()) cleanDraft.amount = draft.amount.trim();
    if (typeof draft.assetCode === 'string' && draft.assetCode.trim()) cleanDraft.assetCode = draft.assetCode.trim().toUpperCase();
    if (typeof draft.description === 'string' && draft.description.trim()) cleanDraft.description = draft.description;
    if (typeof draft.sellerName === 'string' && draft.sellerName.trim()) cleanDraft.sellerName = draft.sellerName;
    if (typeof draft.sellerEmail === 'string' && draft.sellerEmail.trim()) cleanDraft.sellerEmail = draft.sellerEmail;
    if (typeof draft.customerName === 'string' && draft.customerName.trim()) cleanDraft.customerName = draft.customerName;
    if (typeof draft.customerEmail === 'string' && draft.customerEmail.trim()) cleanDraft.customerEmail = draft.customerEmail;
    if (typeof draft.expiresInDays === 'number' && Number.isFinite(draft.expiresInDays)) cleanDraft.expiresInDays = draft.expiresInDays;

    if (Object.keys(cleanDraft).length === 0) {
      storage.removeItem(INVOICE_DRAFT_STORAGE_KEY);
    } else {
      storage.setItem(INVOICE_DRAFT_STORAGE_KEY, JSON.stringify(cleanDraft));
    }
  } catch {
    // Fail silently on quota or storage errors
  }
}

export function loadInvoiceDraft(): InvoiceDraft | null {
  const storage = safeSessionStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(INVOICE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const draft: InvoiceDraft = {};
    if (typeof parsed.amount === 'string') draft.amount = parsed.amount;
    if (typeof parsed.assetCode === 'string') draft.assetCode = parsed.assetCode;
    if (typeof parsed.description === 'string') draft.description = parsed.description;
    if (typeof parsed.sellerName === 'string') draft.sellerName = parsed.sellerName;
    if (typeof parsed.sellerEmail === 'string') draft.sellerEmail = parsed.sellerEmail;
    if (typeof parsed.customerName === 'string') draft.customerName = parsed.customerName;
    if (typeof parsed.customerEmail === 'string') draft.customerEmail = parsed.customerEmail;
    if (typeof parsed.expiresInDays === 'number') draft.expiresInDays = parsed.expiresInDays;

    return draft;
  } catch {
    return null;
  }
}

export function clearInvoiceDraft(): void {
  const storage = safeSessionStorage();
  if (!storage) return;

  try {
    storage.removeItem(INVOICE_DRAFT_STORAGE_KEY);
  } catch {
    // Fail silently
  }
}
