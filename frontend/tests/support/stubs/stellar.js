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
export const sendPayment = async () => '';
export const getExplorerTransactionUrl = (txHash) =>
  `https://stellar.expert/explorer/testnet/tx/${txHash}`;
export const getExplorerAccountUrl = (publicKey) =>
  `https://stellar.expert/explorer/testnet/account/${publicKey}`;
export const describeStellarNetworkError = (error) =>
  error?.message || 'Stellar network error';
export default {};
