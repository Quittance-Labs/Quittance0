import * as StellarSdk from '@stellar/stellar-sdk';
import * as FreighterApi from '@stellar/freighter-api';
import {
  isConnected,
  getPublicKey,
  signTransaction,
  signBlob,
  isAllowed,
  setAllowed,
  getNetwork,
  getNetworkDetails,
} from '@stellar/freighter-api';
import {
  FREIGHTER_CONNECT_REQUIRED_MESSAGE,
  FREIGHTER_REQUIRED_MESSAGE,
  detectFreighter,
  networkMatches,
  wrongNetworkMessage,
} from './freighter-availability';
import { networkDisplayName } from './network-display-name';
import { fitsStellarTextMemo } from '@shared/memo';
import {
  defaultHorizonUrl,
  passphraseFor,
  resolveStellarNetwork,
  walletNetworkMatches,
} from '@shared/network';
import { canonicalAmount } from './stroop-amount.js';
import {
  accountHasTrustline,
  classifyTrustlinePreflight,
  trustlinePreflightMessage,
  type TrustlinePreflight,
} from './trustline-preflight';

// Network configuration — one resolver for the whole app (issue #511):
// NEXT_PUBLIC_STELLAR_NETWORK decides the passphrase Freighter must report,
// the default Horizon URL, and the explorer segment links render. An
// unrecognised value fails at load rather than silently picking a network.
const RESOLVED_NETWORK = resolveStellarNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK);
export const STELLAR_NETWORK = RESOLVED_NETWORK;
export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL || defaultHorizonUrl(RESOLVED_NETWORK);

export const NETWORK_PASSPHRASE = passphraseFor(RESOLVED_NETWORK);

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
  trustlinePreflightMessage('MISSING_TRUSTLINE', assetCode, STELLAR_NETWORK.toLowerCase());

const hasAssetTrustline = (
  account: StellarSdk.Horizon.AccountResponse,
  assetCode: string,
  assetIssuer: string
): boolean => accountHasTrustline(account, assetCode, assetIssuer);

/**
 * Preflight for credit-asset payments (issue #506): resolve the payer's
 * account before Freighter opens so a missing trustline blocks submit with an
 * actionable message. Native XLM short-circuits; a Horizon outage is a
 * retryable failure, never a silent pass.
 */
export const preflightAssetTrustline = async (
  publicKey: string,
  assetCode: string,
  assetIssuer?: string
): Promise<TrustlinePreflight> => {
  const normalizedAssetCode = (assetCode || 'XLM').toUpperCase();
  if (normalizedAssetCode === 'XLM') {
    return { ok: true, code: 'NATIVE_ASSET' };
  }

  let account: StellarSdk.Horizon.AccountResponse | null = null;
  let lookupError: unknown;
  try {
    account = await loadAccount(publicKey);
  } catch (error) {
    lookupError = error;
  }

  return classifyTrustlinePreflight({
    assetCode: normalizedAssetCode,
    assetIssuer,
    account,
    error: lookupError,
    networkLabel: STELLAR_NETWORK.toLowerCase(),
  });
};

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
  // Passphrase-first gate (issue #511): when Freighter reports the network
  // passphrase it must equal the resolved one exactly — a custom network can
  // call itself "TESTNET" but cannot forge the passphrase. Wallets that do
  // not report a passphrase fall back to the name check.
  if (!walletNetworkMatches(RESOLVED_NETWORK, session)) {
    throw new Error(wrongNetworkMessage(EXPECTED_WALLET_NETWORK, session.network));
  }
  return session;
};

/**
 * Check if the given network or passphrase matches our expected network
 */
export const isWrongNetwork = (
  currentNetworkOrPassphrase: string | null | undefined,
  expectedNetwork: string = STELLAR_NETWORK
): boolean => {
  if (!currentNetworkOrPassphrase) return false;
  const current = currentNetworkOrPassphrase.trim();
  const expected = expectedNetwork.toUpperCase();
  const expectedPassphrase =
    expected === 'TESTNET' ? StellarSdk.Networks.TESTNET : StellarSdk.Networks.PUBLIC;

  if (
    current.toUpperCase() === expected ||
    current === expectedPassphrase
  ) {
    return false;
  }

  // Check if current is matching known counterpart
  if (expected === 'TESTNET' && current.toLowerCase().includes('test sdf network')) {
    return false;
  }
  if (expected === 'PUBLIC' && current.toLowerCase().includes('public global stellar network')) {
    return false;
  }

  return true;
};

/**
 * Watch Freighter network changes on an interval
 */
export const watchFreighterNetwork = (
  callback: (
    details: {
      network: string | null;
      networkPassphrase: string | null;
      isWrongNetwork: boolean;
    } | null
  ) => void,
  intervalMs = 2500
): (() => void) => {
  let active = true;

  const poll = async () => {
    if (!active) return;
    try {
      const details = await getFreighterNetwork();
      if (!active) return;
      if (details) {
        const wrong = isWrongNetwork(details.networkPassphrase || details.network);
        callback({ ...details, isWrongNetwork: wrong });
      } else {
        callback(null);
      }
    } catch {
      if (active) callback(null);
    }
  };

  void poll();
  const intervalId = setInterval(poll, intervalMs);

  return () => {
    active = false;
    clearInterval(intervalId);
  };
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

    const normalizedAssetCode = (assetCode || 'XLM').toUpperCase();

    // Create asset
    const asset =
      normalizedAssetCode === 'XLM'
        ? StellarSdk.Asset.native()
        : new StellarSdk.Asset(normalizedAssetCode, assetIssuer!);

    if (
      normalizedAssetCode !== 'XLM' &&
      assetIssuer &&
      !hasAssetTrustline(account, normalizedAssetCode, assetIssuer)
    ) {
      throw new Error(getTrustlineMessage(normalizedAssetCode));
    }

    // Invoice memos are Stellar text memos: refuse before building if the
    // memo cannot fit, so the failure is the contract's message rather than
    // the SDK's opaque `Memo.text` throw.
    if (!fitsStellarTextMemo(memo)) {
      throw new Error('Invoice memo exceeds the 28-byte Stellar text memo limit');
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
          // Canonical stroop string: the SDK rejects exponent notation like
          // `1e-7`, and any float formatting risks a one-stroop drift.
          amount: formatStellarAmount(amount),
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
 * Explicit change_trust for a credit asset (issue #506).
 *
 * Separate from the payment builder: the payer must click an Add Trustline
 * control before Freighter opens for this transaction. Never fold this
 * operation into sendPayment / buildInvoicePayment.
 */
export const addTrustline = async (
  assetCode: string,
  assetIssuer: string
): Promise<string> => {
  const session = await assertFreighterReady();
  const userPublicKey = session.publicKey as string;

  const normalizedCode = (assetCode || '').trim().toUpperCase();
  if (!normalizedCode || normalizedCode === 'XLM') {
    throw new Error('Native XLM does not need a trustline');
  }
  if (!assetIssuer) {
    throw new Error('Asset issuer is required to add a trustline');
  }

  let account;
  try {
    account = await loadAccount(userPublicKey);
  } catch (error: any) {
    if (error?.message?.includes('Not Found') || error?.response?.status === 404) {
      throw new Error(
        trustlinePreflightMessage('ACCOUNT_NOT_FOUND', normalizedCode, STELLAR_NETWORK.toLowerCase())
      );
    }
    throw new Error(
      trustlinePreflightMessage('HORIZON_UNAVAILABLE', normalizedCode, STELLAR_NETWORK.toLowerCase())
    );
  }

  if (hasAssetTrustline(account, normalizedCode, assetIssuer)) {
    return '';
  }

  const asset = new StellarSdk.Asset(normalizedCode, assetIssuer);
  const transaction = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(StellarSdk.Operation.changeTrust({ asset }))
    .setTimeout(180)
    .build();

  const signedResult = await signTransaction(transaction.toXDR(), {
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  const signedTxXdr = readResultString(signedResult, ['signedTxXdr']);
  if (!signedTxXdr) {
    throw new Error('Freighter did not return a signed change_trust transaction');
  }

  const signedTx = StellarSdk.TransactionBuilder.fromXDR(signedTxXdr, NETWORK_PASSPHRASE);
  const result = await server.submitTransaction(signedTx as any);
  return result.hash;
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
 * The one seller-proof message for cancel (issue #517): the connected wallet
 * signs exactly `cancel:<invoiceId>` — one canonical message on one canonical
 * transport (the request body), so a stale query param or header cannot
 * smuggle a different seller key past the gate.
 */
export const CANCEL_INVOICE_MESSAGE_PREFIX = 'cancel:';

export const signInvoiceCancelMessage = async (
  invoiceId: string
): Promise<{ publicKey: string; signature: string }> => {
  const session = await assertFreighterReady();
  const message = `${CANCEL_INVOICE_MESSAGE_PREFIX}${invoiceId}`;
  // ASCII-only message, so btoa is a safe UTF-8→base64 step here.
  const signed = await signBlob(btoa(message), { accountToSign: session.publicKey! });
  const signature = readResultString(signed as any, ['signedBlob', 'signature']) ||
    (typeof signed === 'string' ? signed : null);
  if (!signature) {
    throw new Error('Freighter did not return a cancel signature');
  }
  return { publicKey: session.publicKey!, signature };
};

/**
 * Format a Stellar amount for operations and display. Routes through the
 * stroop helpers so small amounts never surface as exponent strings like
 * `1e-7`, which neither the SDK nor the SEP-0007 URI schema accepts.
 */
export const formatStellarAmount = (amount: string | number): string => {
  return canonicalAmount(amount) ?? amount.toString();
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

const stellarService = {
  server,
  STELLAR_NETWORK,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  NETWORK_DISPLAY_NAME,
  checkWalletConnection,
  requestWalletAccess,
  getUserPublicKey,
  getFreighterNetwork,
  isWrongNetwork,
  watchFreighterNetwork,
  loadAccount,
  getAccountBalance,
  preflightAssetTrustline,
  addTrustline,
  sendPayment,
  getTransaction,
  checkTransactionStatus,
  streamPayments,
  formatStellarAmount,
  isValidPublicKey,
  describeStellarNetworkError,
};

export default stellarService;
