import * as StellarSdk from '@stellar/stellar-sdk';
import {
  isConnected,
  getPublicKey,
  signTransaction,
  isAllowed,
  setAllowed,
} from '@stellar/freighter-api';

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

export const server = new StellarSdk.Horizon.Server(HORIZON_URL);

// File-local Horizon SDK shape aliases — drop the previously hand-rolled
// narrower types in favour of the SDK's own discriminated unions. Using
// the SDK types keeps the typed surface in lock-step with whatever
// Horizon serialises on the wire; any future Horizon drift surfaces
// here at compile time. Tradeoff: these carry more fields than we read;
// that's acceptable because (a) the SDK discriminants keep type narrowing
// accurate, and (b) the public `onPayment` callback is a narrow
// `PaymentOperationRecord` subset (post-`type === 'payment'` runtime
// filter narrows the SDK's `OperationRecord` union).
//
// Access path: `StellarSdk.Horizon.<Namespace>.<Type>` because
// `lib/horizon/index.d.ts` re-exports the `ServerApi` and `HorizonApi`
// namespaces from `server_api.d.ts` / `horizon_api.d.ts` unchanged.
type HorizonBalance = StellarSdk.Horizon.AccountResponse['balances'][number];
type HorizonTransaction = StellarSdk.Horizon.ServerApi.TransactionRecord;
type HorizonPaymentOperation = StellarSdk.Horizon.ServerApi.PaymentOperationRecord;

const getTrustlineMessage = (assetCode: string): string =>
  `Your wallet does not have a ${assetCode} trustline on ${STELLAR_NETWORK.toLowerCase()}. Add the ${assetCode} trustline in Freighter, or ask the seller for an XLM invoice.`;

const hasAssetTrustline = (
  account: StellarSdk.Horizon.AccountResponse,
  assetCode: string,
  assetIssuer: string
): boolean =>
  account.balances.some(
    (balance) =>
      // Native and liquidity-pool shares have no `asset_code`/`asset_issuer`;
      // restrict to the typed `BalanceLineAsset<credit_alphanum4|12>` subset
      // so the property accesses below are type-safe. The runtime literal
      // check is the right discriminator (the SDK exposes the union under
      // discriminator `balance.asset_type: AssetType`).
      (balance.asset_type === 'credit_alphanum4' ||
        balance.asset_type === 'credit_alphanum12') &&
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

/**
 * Check if Freighter wallet is available and connected
 */
export const checkWalletConnection = async (): Promise<boolean> => {
  try {
    return await isConnected();
  } catch (error) {
    console.error('Error checking wallet connection:', error);
    return false;
  }
};

/**
 * Request permission to access wallet
 */
export const requestWalletAccess = async (): Promise<boolean> => {
  try {
    await setAllowed();
    return await isAllowed();
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
    return publicKey;
  } catch (error) {
    console.error('Error getting public key:', error);
    return null;
  }
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
    return account.balances
      // Liquidity-pool shares balance lines have no `asset_code`; filter them
      // out. Native + credit_alphanum(4|12) survive (`asset_type` literal
      // narrows the union automatically — BalanceLineLiquidityPool removed).
      .filter((balance) => balance.asset_type !== 'liquidity_pool_shares')
      .map((balance) => ({
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
    // Check wallet connection
    const connected = await checkWalletConnection();
    if (!connected) {
      throw new Error('Wallet not connected');
    }

    // Get user public key
    const userPublicKey = await getUserPublicKey();
    if (!userPublicKey) {
      throw new Error('Could not get user public key');
    }

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
    const signedTxXdr = await signTransaction(transaction.toXDR(), {
      networkPassphrase: NETWORK_PASSPHRASE,
    });

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
export const getTransaction = async (txHash: string): Promise<HorizonTransaction> => {
  try {
    // SDK's `.call()` already returns `ServerApi.TransactionRecord`; no
    // cast needed. Our `HorizonTransaction` alias binds directly.
    return await server.transactions().transaction(txHash).call();
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
  onPayment: (payment: HorizonPaymentOperation) => void
) => {
  const closeHandler = server
    .payments()
    .forAccount(publicKey)
    .cursor('now')
    .stream({
      // SDK typing caveat: `CallBuilder<T>.stream()` infers the onmessage
      // value type from `.call()`'s return — `CollectionPage<operation-record
      // union>` here — but at runtime the EventSource emits INDIVIDUAL
      // operation records (one per event), not CollectionPage-wrapped. The
      // SDK's stream typing is a known quirk; we cast from the wrongly-
      // inferred CollectionPage value to a single `OperationRecord`
      // (a union over `ServerApi.*OperationRecord` discriminated by `type`).
      // The runtime narrows via `record.type === 'payment'` before invoking
      // the typed `onPayment` callback (Payment-only).
      onmessage: (rawValue) => {
        const record =
          rawValue as unknown as StellarSdk.Horizon.ServerApi.OperationRecord;
        if (record.type === 'payment') {
          onPayment(record as HorizonPaymentOperation);
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
