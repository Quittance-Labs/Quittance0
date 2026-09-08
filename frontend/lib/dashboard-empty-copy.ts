export function dashboardEmptyMessage(walletConnected: boolean): string {
  return walletConnected
    ? 'Create your first invoice to get started.'
    : 'Connect your wallet to see and create invoices.';
}
