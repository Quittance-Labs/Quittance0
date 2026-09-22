/**
 * `@/lib/stellar` without the Stellar SDK.
 *
 * The real module pulls in `@stellar/stellar-sdk`, which is megabytes of
 * bundle for code that never runs in this audit — nothing here submits a
 * transaction. Stubbing it keeps the suite to a couple of seconds.
 */
export const server = { payments: () => ({ forAccount: () => ({ cursor: () => ({ stream: () => () => {} }) }) }) };
export const EXPECTED_WALLET_NETWORK = 'TESTNET';
export const NETWORK_DISPLAY_NAME = 'Testnet';
let customWalletConnection = null;
let customWalletAccess = null;

export const setWalletConnectionStub = (fn) => {
  customWalletConnection = fn;
};
export const resetWalletConnectionStub = () => {
  customWalletConnection = null;
};
export const setWalletAccessStub = (fn) => {
  customWalletAccess = fn;
};
export const resetWalletAccessStub = () => {
  customWalletAccess = null;
};

export const checkWalletConnection = async () => {
  if (customWalletConnection) return customWalletConnection();
  return false;
};
export const requestWalletAccess = async () => {
  if (customWalletAccess) return customWalletAccess();
  return false;
};
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

let customSendPayment = null;
export const setSendPaymentStub = (fn) => {
  customSendPayment = fn;
};
export const resetSendPaymentStub = () => {
  customSendPayment = null;
};
export const sendPayment = async (...args) => {
  if (customSendPayment) return customSendPayment(...args);
  return '';
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
