export type InvoiceWorkspaceAccessState =
  | 'wallet-required'
  | 'foreign-wallet'
  | 'allowed';

export function invoiceWorkspaceAccess(
  invoice?: { sellerPublicKey?: string } | null,
  connectedWallet?: string | null
): InvoiceWorkspaceAccessState;

export function canViewInvoiceWorkspace(
  invoice?: { sellerPublicKey?: string } | null,
  connectedWallet?: string | null
): boolean;
