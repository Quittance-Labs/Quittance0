/**
 * @stellar/freighter-api stub for the a11y bundle.
 *
 * The a11y tests render and audit DOM; they never execute a Stellar transaction.
 * This stub exposes the API surface the builder uses so the bundle resolves.
 */
export const signTransaction = async () => { throw new Error('Freighter not available in test'); };
export const signBlob = async () => { throw new Error('Freighter not available in test'); };
export const isConnected = async () => ({ isConnected: false });
export const isAllowed = async () => ({ isAllowed: false });
export const setAllowed = async () => ({ isAllowed: false });
export const getPublicKey = async () => null;
export const getNetwork = async () => ({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
export const getNetworkDetails = async () => null;

const freighterStub = { signTransaction, signBlob, isConnected, isAllowed, setAllowed, getPublicKey, getNetwork, getNetworkDetails };
export default freighterStub;
