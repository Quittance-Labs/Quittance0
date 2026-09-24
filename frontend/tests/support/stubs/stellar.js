/**
 * `@/lib/stellar` without the Stellar SDK.
 *
 * The real module pulls in `@stellar/stellar-sdk`, which is megabytes of
 * bundle for code that never runs in this audit — nothing here submits a
 * transaction. Stubbing it keeps the suite to a couple of seconds.
 */
export const server = { payments: () => ({ forAccount: () => ({ cursor: () => ({ stream: () => () => {} }) }) }), submitTransaction: async () => ({ hash: 'a'.repeat(64) }) };
export const EXPECTED_WALLET_NETWORK = 'TESTNET';
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
export const NETWORK_DISPLAY_NAME = 'Testnet';
export const checkWalletConnection = async () => false;
export const requestWalletAccess = async () => false;
export const getUserPublicKey = async () => null;
export const getFreighterNetwork = async () => ({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
export const readFreighterSession = async () => ({
  freighterAvailable: false,
  connected: false,
  publicKey: null,
  network: null,
  networkPassphrase: null,
});
export const stopFreighterWalletWatcher = () => () => {};
export const getAccountBalance = async () => [];
export const preflightAssetTrustline = async () => ({ ok: true, code: 'OK' });
export const addTrustline = async () => 'b' + 'c'.repeat(63);
export const sendPayment = async () => '';
export const loadAccount = async () => ({
  id: 'STUB',
  balances: [
    { asset_type: 'native', balance: '100.0000000' },
    { asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', balance: '50.0000000' },
  ],
});
export const assertFreighterReady = async () => ({
  freighterAvailable: true,
  connected: true,
  publicKey: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
  network: 'TESTNET',
  networkPassphrase: 'Test SDF Network ; September 2015',
});
export const isValidPublicKey = (pk) => {
  try { return typeof pk === 'string' && /^G[A-Z2-7]{55}$/.test(pk); } catch { return false; }
};
export const getExplorerTransactionUrl = (txHash) =>
  `https://stellar.expert/explorer/testnet/tx/${txHash}`;
export const getExplorerAccountUrl = (publicKey) =>
  `https://stellar.expert/explorer/testnet/account/${publicKey}`;
export const describeStellarNetworkError = (error) =>
  error?.message || 'Stellar network error';
export const isWrongNetwork = () => false;
export const watchFreighterNetwork = () => () => {};
export const STELLAR_NETWORK = 'TESTNET';
export const STELLAR_PASSPHRASE = 'Test SDF Network ; September 2015';
export const CANCEL_INVOICE_MESSAGE_PREFIX = 'cancel:';
export const signInvoiceCancelMessage = async (invoiceId) => ({
  publicKey: null,
  signature: null,
});

const stellarExports = {
  server,
  checkWalletConnection,
  requestWalletAccess,
  getUserPublicKey,
  getAccountBalance,
  preflightAssetTrustline,
  addTrustline,
  sendPayment,
  loadAccount,
  assertFreighterReady,
  isValidPublicKey,
  getExplorerTransactionUrl,
  describeStellarNetworkError,
  getFreighterNetwork,
  isWrongNetwork,
  watchFreighterNetwork,
  STELLAR_NETWORK,
  STELLAR_PASSPHRASE,
  NETWORK_PASSPHRASE,
  NETWORK_DISPLAY_NAME,
  CANCEL_INVOICE_MESSAGE_PREFIX,
  signInvoiceCancelMessage,
  EXPECTED_WALLET_NETWORK,
};

export default stellarExports;
