/**
 * `@/lib/stellar` without the Stellar SDK.
 *
 * The real module pulls in `@stellar/stellar-sdk`, which is megabytes of
 * bundle for code that never runs in this audit — nothing here submits a
 * transaction. Stubbing it keeps the suite to a couple of seconds.
 */
export const server = { payments: () => ({ forAccount: () => ({ cursor: () => ({ stream: () => () => {} }) }) }) };
export const checkWalletConnection = async () => false;
export const requestWalletAccess = async () => false;
export const getUserPublicKey = async () => null;
export const getAccountBalance = async () => [];
export const sendPayment = async () => '';
export const getExplorerTransactionUrl = (txHash) =>
  `https://stellar.expert/explorer/testnet/tx/${txHash}`;
export const describeStellarNetworkError = (error) =>
  error?.message || 'Stellar network error';
export const getFreighterNetwork = async () => ({ network: 'TESTNET', networkUrl: '', networkPassphrase: '' });
export const isWrongNetwork = () => false;
export const watchFreighterNetwork = () => () => {};
export const STELLAR_NETWORK = 'TESTNET';
export const STELLAR_PASSPHRASE = 'Test SDF Network ; September 2015';
export const NETWORK_DISPLAY_NAME = 'Testnet';

const stellarExports = {
  server,
  checkWalletConnection,
  requestWalletAccess,
  getUserPublicKey,
  getAccountBalance,
  sendPayment,
  getExplorerTransactionUrl,
  describeStellarNetworkError,
  getFreighterNetwork,
  isWrongNetwork,
  watchFreighterNetwork,
  STELLAR_NETWORK,
  STELLAR_PASSPHRASE,
  NETWORK_DISPLAY_NAME,
};

export default stellarExports;
