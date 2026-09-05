import * as StellarSdk from '@stellar/stellar-sdk';
import * as FreighterApi from '@stellar/freighter-api';
import {
  isConnected,
  getPublicKey,
  signTransaction,
  isAllowed,
  setAllowed,
} from '@stellar/freighter-api';
import {
  FREIGHTER_CONNECT_REQUIRED_MESSAGE,
  FREIGHTER_REQUIRED_MESSAGE,
  detectFreighter,
  networkMatches,
  wrongNetworkMessage,
} from './freighter-availability';
import { networkDisplayName } from './network-display-name';

// Network configuration
const STELLAR_NETWORK = process.env.NEXT_PUBLIC_STELLAR_NETWORK || 'TESTNET';
const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ||
  (STELLAR_NETWORK === 'TESTNET'
    ? 'https://horizon-testnet.stellar.org'
    : 'https://horizon.stellar.org');

export const NETWORK_PASSPHRASE =
  STELLAR_NETWORK === 'TESTNET'
    ? StellarSdk.Networks.TESTNET
    : StellarSdk.Networks.PUBLIC;

export const NETWORK_DISPLAY_NAME = networkDisplayName(NETWORK_PASSPHRASE);
export const EXPECTED_WALLET_NETWORK = STELLAR_NETWORK.toUpperCase();

export const server = new StellarSdk.Horizon.Server(HORIZON_URL);

export const getExplorerTransactionUrl = (txHash: string): string => {
  const network = STELLAR_NETWORK === 'TESTNET' ? 'testnet' : 'public';
  return `https://stellar.expert/explorer/${network}/tx/${encodeURIComponent(txHash)}`;
};

export const getExplorerAccountUrl = (publicKey: string, walletNetwork = STELLAR_NETWORK): string => {
  const network = walletNetwork === 'PUBLIC' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/account/${encodeURIComponent(publicKey)}`;
};

const getTrustlineMessage = (assetCode: string): string =>
  `Your wallet does not have a ${assetCode} trustline on ${STELLAR_NETWORK.toLowerCase()}. Add the ${assetCode} trustline in Freighter, or ask the seller for an XLM invoice.`;

const hasAssetTrustline = (
  account: StellarSdk.Horizon.AccountResponse,
  assetCode: string,
  assetIssuer: string
): boolean =>
  account.balances.some(
    (balance: any) =>
      balance.asset_type !== 'native' &&
      balance.asset_code === assetCode &&
      balance.asset_issuer === assetIssuer
  );

const isMissingTrustlineError = (error: any): boolean => {
  const operationCodes = error?.response?.data?.extras?.result_codes?.operations;
  return (
    operationCodes?.includes('op_no_trust') ||
    error?.message?.toLowerCase().includes('op_no_trust') ||
    error?.message?.toLowerCase().includes('no trustline')
  );
};

export const describeStellarNetworkError = (error: any): string => {
  if (error?.message?.includes('Not Found') || error?.response?.status === 404) {
    return 'Account needs funding on the selected Stellar network.';
  }
  if (!error?.response || ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'].includes(error?.code)) {
    return 'Stellar Horizon is temporarily unreachable. Your wallet can stay connected; retry shortly.';
  }
  return error?.message || 'Stellar network request failed.';
};

const readResultBoolean = (value: any, key: string): boolean => {
  if (typeof value === 'boolean') return value;
  if (value?.error) return false;
  if (typeof value?.[key] === 'boolean') return value[key];
  return Boolean(value);
};

const readResultString = (value: any, keys: string[]): string | null => {
  if (typeof value === 'string') return value || null;
  if (value?.error) return null;
  for (const key of keys) {
    if (typeof value?.[key] === 'string' && value[key]) return value[key];
  }
  return null;
};

export interface FreighterNetwork {
  network: string | null;
  networkPassphrase: string | null;
}

export interface FreighterSession {
  freighterAvailable: boolean;
  connected: boolean;
  publicKey: string | null;
  network: string | null;
  networkPassphrase: string | null;
}

/**
 * Check whether the Freighter extension API is available
 */
export const checkWalletConnection = async (): Promise<boolean> => {
  return detectFreighter(isConnected);
};

/**
 * Request permission to access wallet
 */
export const requestWalletAccess = async (): Promise<boolean> => {
  try {
    const allowed = await setAllowed();
    if (readResultBoolean(allowed, 'isAllowed')) return true;
    return readResultBoolean(await isAllowed(), 'isAllowed');
  } catch (error) {
    console.error('Error requesting wallet access:', error);
    return false;
  }
};

/**
 * Get user's public key from wallet
 */
export const getUserPublicKey = async (): Promise<string | null> => {
  try {
    const publicKey = await getPublicKey();
    const normalized = readResultString(publicKey, ['publicKey', 'address']);
    if (normalized) return normalized;

    const getAddress = (FreighterApi as any).getAddress;
    if (typeof getAddress === 'function') {
      return readResultString(await getAddress(), ['address', 'publicKey']);
    }
    return null;
  } catch (error) {
    console.error('Error getting public key:', error);
    return null;
  }
};

export const getFreighterNetwork = async (): Promise<FreighterNetwork> => {
  const getNetwork = (FreighterApi as any).getNetwork;
  if (typeof getNetwork !== 'function') {
    return { network: null, networkPassphrase: null };
  }

  try {
    const result = await getNetwork();
    if (result?.error) return { network: null, networkPassphrase: null };
    return {
      network: readResultString(result?.network ?? result, ['network']),
      networkPassphrase: readResultString(result?.networkPassphrase, ['networkPassphrase']),
    };
  } catch (error) {
    console.error('Error getting Freighter network:', error);
    return { network: null, networkPassphrase: null };
  }
};

export const readFreighterSession = async (): Promise<FreighterSession> => {
  const freighterAvailable = await checkWalletConnection();
  if (!freighterAvailable) {
    return {
      freighterAvailable: false,
      connected: false,
      publicKey: null,
      network: null,
      networkPassphrase: null,
    };
  }

  const [allowed, publicKey, network] = await Promise.all([
    isAllowed().then((value) => readResultBoolean(value, 'isAllowed')).catch(() => false),
    getUserPublicKey(),
    getFreighterNetwork(),
  ]);

  return {
    freighterAvailable: true,
    connected: allowed && Boolean(publicKey),
    publicKey,
    network: network.network,
    networkPassphrase: network.networkPassphrase,
  };
};

export const stopFreighterWalletWatcher = (
  onChange: (session: FreighterSession) => void,
  intervalMs = 1000
): (() => void) => {
  const WatchWalletChanges = (FreighterApi as any).WatchWalletChanges;
  if (typeof WatchWalletChanges !== 'function') return () => {};

  const watcher = new WatchWalletChanges(intervalMs);
  watcher.watch((change: any) => {
    onChange({
      freighterAvailable: true,
      connected: Boolean(change?.address || change?.publicKey),
      publicKey: change?.address || change?.publicKey || null,
      network: change?.network || null,
      networkPassphrase: change?.networkPassphrase || null,
    });
  });

  return () => watcher.stop();
};

export const assertFreighterReady = async (): Promise<FreighterSession> => {
  const session = await readFreighterSession();
  if (!session.freighterAvailable) throw new Error(FREIGHTER_REQUIRED_MESSAGE);
  if (!session.connected || !session.publicKey) throw new Error(FREIGHTER_CONNECT_REQUIRED_MESSAGE);
  if (!networkMatches(session.network, EXPECTED_WALLET_NETWORK)) {
    throw new Error(wrongNetworkMessage(EXPECTED_WALLET_NETWORK, session.network));
  }
  return session;
};

/**
 * Load account from Stellar network
 */
export const loadAccount = async (
  publicKey: string
): Promise<StellarSdk.Horizon.AccountResponse> => {
  return await server.loadAccount(publicKey);
};

/**
 * Get account balance
 */
export const getAccountBalance = async (
  publicKey: string
): Promise<Array<{ assetCode: string; balance: string }>> => {
  try {
    const account = await loadAccount(publicKey);
    return account.balances.map((balance: any) => ({
      assetCode: balance.asset_type === 'native' ? 'XLM' : balance.asset_code,
      balance: balance.balance,
    }));
  } catch (error: any) {
    console.error('Error getting balance:', error);
    // If account not found, return empty balance
    if (error.message?.includes('Not Found') || error.response?.status === 404) {
      return [{ assetCode: 'XLM', balance: '0.0000000' }];
    }
    throw error;
  }
};

/**
 * Send payment with memo
 */
export const sendPayment = async (
  destination: string,
  amount: string,
  memo: string,
  assetCode: string = 'XLM',
  assetIssuer?: string
): Promise<string> => {
  try {
    const session = await assertFreighterReady();
    const userPublicKey = session.publicKey as string;

    // Load account
    let account;
    try {
      account = await loadAccount(userPublicKey);
    } catch (error: any) {
      if (error.message?.includes('Not Found') || error.response?.status === 404) {
        throw new Error('Account not funded. Please get test XLM from Stellar Laboratory first.');
      }
      throw error;
    }

    // Create asset
    const asset =
      assetCode === 'XLM'
        ? StellarSdk.Asset.native()
        : new StellarSdk.Asset(assetCode, assetIssuer!);

    if (
      assetCode !== 'XLM' &&
      assetIssuer &&
      !hasAssetTrustline(account, assetCode, assetIssuer)
    ) {
      throw new Error(getTrustlineMessage(assetCode));
    }

    // Build transaction
    const transaction = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination,
          asset,
          amount,
        })
      )
      .addMemo(StellarSdk.Memo.text(memo))
      .setTimeout(180)
      .build();

    // Sign with Freighter
    const signedResult = await signTransaction(transaction.toXDR(), {
      networkPassphrase: NETWORK_PASSPHRASE,
    });
    const signedTxXdr = readResultString(signedResult, ['signedTxXdr']);
    if (!signedTxXdr) {
      throw new Error('Freighter did not return a signed transaction');
    }

    // Parse signed transaction
    const signedTx = StellarSdk.TransactionBuilder.fromXDR(
      signedTxXdr,
      NETWORK_PASSPHRASE
    );

    // Submit to network
    const result = await server.submitTransaction(signedTx as any);

    console.log('Payment successful:', result.hash);
    return result.hash;
  } catch (error: any) {
    console.error('Payment error:', error);
    if (assetCode !== 'XLM' && isMissingTrustlineError(error)) {
      throw new Error(getTrustlineMessage(assetCode));
    }
    throw new Error(error.message || 'Payment failed');
  }
};

/**
 * Get transaction details
 */
export const getTransaction = async (txHash: string): Promise<any> => {
  try {
    const transaction = await server.transactions().transaction(txHash).call();
    return transaction;
  } catch (error) {
    console.error('Error fetching transaction:', error);
    throw error;
  }
};

/**
 * Check transaction status
 */
export const checkTransactionStatus = async (
  txHash: string
): Promise<'success' | 'failed' | 'pending'> => {
  try {
    const tx = await getTransaction(txHash);
    return tx.successful ? 'success' : 'failed';
  } catch (error) {
    return 'pending';
  }
};

/**
 * Stream payments for an account
 */
export const streamPayments = (
  publicKey: string,
  onPayment: (payment: any) => void
) => {
  const closeHandler = server
    .payments()
    .forAccount(publicKey)
    .cursor('now')
    .stream({
      onmessage: (payment: any) => {
        if (payment.type === 'payment') {
          onPayment(payment);
        }
      },
      onerror: (error: any) => {
        console.error('Payment stream error:', error);
      },
    });

  return closeHandler;
};

/**
 * Format Stellar amount (remove trailing zeros)
 */
export const formatStellarAmount = (amount: string | number): string => {
  return parseFloat(amount.toString()).toString();
};

/**
 * Validate Stellar public key
 */
export const isValidPublicKey = (publicKey: string): boolean => {
  try {
    StellarSdk.Keypair.fromPublicKey(publicKey);
    return true;
  } catch {
    return false;
  }
};

export default {
  server,
  NETWORK_PASSPHRASE,
  checkWalletConnection,
  requestWalletAccess,
  getUserPublicKey,
  loadAccount,
  getAccountBalance,
  sendPayment,
  getTransaction,
  checkTransactionStatus,
  streamPayments,
  formatStellarAmount,
  isValidPublicKey,
  describeStellarNetworkError,
};
