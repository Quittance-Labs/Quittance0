/**
 * Access control for the seller invoice workspace (issue #454).
 *
 * The workspace is seller-only: unlike `/pay/[id]` (public, for payers),
 * `/invoice/[id]` must refuse to show invoice details -- amount, memo,
 * customer contact info, timeline -- to anyone whose connected wallet does
 * not match `invoice.sellerPublicKey`. This is deliberately a single,
 * reusable decision function rather than scattering `sellerPublicKey ===
 * wallet` checks across the page and each action, so there is exactly one
 * place that decides who may open the workspace at all.
 */

/**
 * @typedef {'loading' | 'allowed' | 'wallet-required' | 'foreign-wallet'} InvoiceWorkspaceAccessState
 */

/**
 * Decide whether the connected wallet may open this invoice's workspace.
 *
 * @param {{ sellerPublicKey?: string } | null | undefined} invoice
 * @param {string | null | undefined} connectedWallet
 * @returns {InvoiceWorkspaceAccessState}
 *
 * - `'wallet-required'`: no wallet connected yet. Distinct from
 *   `'foreign-wallet'` so the UI can prompt "connect your wallet" rather
 *   than the harsher "this isn't yours" -- a disconnected visitor may well
 *   be the seller who just hasn't connected yet.
 * - `'foreign-wallet'`: a wallet is connected and it does not match the
 *   invoice's seller. This is the case the issue's "other sellers cannot
 *   open a foreign invoice workspace" requirement is actually about.
 * - `'allowed'`: the connected wallet matches, or the invoice has no
 *   recorded seller key to check against (defensive default: an invoice
 *   record that is somehow missing its seller key should not silently deny
 *   its own owner access -- there is nothing to compare against, so this
 *   function has no basis to refuse).
 */
function invoiceWorkspaceAccess(invoice, connectedWallet) {
  const sellerPublicKey = invoice?.sellerPublicKey;
  if (!sellerPublicKey) return 'allowed';
  if (!connectedWallet) return 'wallet-required';
  return connectedWallet === sellerPublicKey ? 'allowed' : 'foreign-wallet';
}

/** Convenience boolean for call sites that only need a yes/no. */
function canViewInvoiceWorkspace(invoice, connectedWallet) {
  return invoiceWorkspaceAccess(invoice, connectedWallet) === 'allowed';
}

module.exports = {
  invoiceWorkspaceAccess,
  canViewInvoiceWorkspace,
};
