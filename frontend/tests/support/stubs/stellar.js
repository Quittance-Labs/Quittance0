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
export default {};
