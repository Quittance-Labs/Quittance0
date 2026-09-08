function dashboardEmptyMessage(walletConnected) {
  return walletConnected
    ? 'Create your first invoice to get started.'
    : 'Connect your wallet to see and create invoices.';
}

module.exports = { dashboardEmptyMessage };
