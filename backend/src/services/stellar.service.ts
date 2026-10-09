import { emitOperationalFailure } from '../observability/log-events';
import * as StellarSdk from '@stellar/stellar-sdk';
import { server, NETWORK_PASSPHRASE, STELLAR_NETWORK, getSellerKeypair } from '../config/stellar';
import {
  checkTxHash,
  failure,
  verifyHorizonPayment,
  normalizePaymentOperation,
  destinationMatches,
} from './payment-verification';
import { fitsStellarTextMemo } from '../../../shared/memo';
import type {
  ExpectedPayment,
  VerificationResult,
  VerifiedPayment,
  HorizonOperationLike,
  HorizonTransactionLike,
} from './payment-verification';
import {
  classifyHorizonFailure,
  horizonCall,
  isHorizonUnavailable,
} from '../utils/horizon-client';

export interface HorizonTransactionDetails {
  transaction: HorizonTransactionLike;
  operations: HorizonOperationLike[];
  /** Network of the Horizon source, independent of a monitor's configuration. */
  network?: string;
}

export interface PaymentRecord {
  id: string;
  txHash: string;
  from: string;
  to: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  memo?: string;
  memoType?: string;
  ledger: number;
  createdAt: string;
  operationType?: string;
  /** The observed transaction envelope; operations are fetched for memo candidates. */
  transaction?: HorizonTransactionLike;
}

export interface ClaimableBalanceRecord {
  balanceId: string;
  txHash: string;
  claimant: string;
  memo?: string;
  memoType?: string;
  amount: string;
  asset: string;
  predicate: unknown;
}


export interface PaymentPageRecord {
  pagingToken: string;
  ledger?: number;
  payment?: PaymentRecord;
  claimableBalance?: ClaimableBalanceRecord;
}

class StellarService {
  /**
   * Load account details from Stellar network
   */
  async loadAccount(publicKey: string): Promise<StellarSdk.Horizon.AccountResponse> {
    try {
      return await horizonCall(() => server.loadAccount(publicKey), { label: 'loadAccount' });
    } catch (error: any) {
      emitOperationalFailure('stellar.account');
      if (isHorizonUnavailable(error)) {
        throw error;
      }
      throw new Error(`Account not found or network error: ${error.message}`);
    }
  }

  /**
   * Get account balance
   */
  async getBalance(publicKey: string): Promise<Array<{ assetCode: string; balance: string }>> {
    const account = await this.loadAccount(publicKey);
    return account.balances.map((balance: any) => ({
      assetCode: balance.asset_type === 'native' ? 'XLM' : balance.asset_code,
      balance: balance.balance,
    }));
  }

/**
 * Verify a payment transaction against the shared verification contract
 * (issue #224): memo, destination, amount, asset, and network.
 *
 * Returns a result rather than throwing so callers can surface the same
 * rejection code and message as the invoice verify endpoints. The codes and
 * their user-facing wording come from `payment-verification.ts` — the same
 * canonical table the pay page mirrors — so every rejection reads identically
 * no matter which entry point produced it.
 */
  async verifyPayment(
    txHash: string,
    expected: ExpectedPayment,
    network?: string
  ): Promise<VerificationResult<VerifiedPayment>> {
    const hashCheck = checkTxHash(txHash);
    if (!hashCheck.ok) {
      return hashCheck;
    }

    let txDetails: { transaction: any; operations: any[] };
    try {
      txDetails = await this.getTransaction(hashCheck.value);
    } catch (error: any) {
      emitOperationalFailure('stellar.verify');
      // Classify before any memo/destination/amount compare (issue #556).
      if (classifyHorizonFailure(error)) {
        // An overloaded or unreachable Horizon is not a missing transaction —
        // report the outage so the payer retries instead of a 404 that caches.
        return failure('VERIFY_UNAVAILABLE');
      }
      return failure('TRANSACTION_NOT_FOUND');
    }

    return verifyHorizonPayment({
      txHash: hashCheck.value,
      expected,
      transaction: txDetails.transaction,
      operations: txDetails.operations,
      network,
    });
  }

  /**
   * Get transaction details
   */
  async getTransaction(
    txHash: string,
    observedTransaction?: HorizonTransactionLike
  ): Promise<HorizonTransactionDetails> {
    try {
      const transaction = observedTransaction ?? await horizonCall(
        () => server.transactions().transaction(txHash).call(),
        { label: 'transactions().transaction' }
      );
      const operations = await horizonCall(
        () => server.operations().forTransaction(txHash).order('asc').limit(200).call(),
        { label: 'operations().forTransaction' }
      );

      return {
        transaction,
        operations: operations.records,
        network: STELLAR_NETWORK,
      };
    } catch (error: any) {
      emitOperationalFailure('stellar.transaction');
      if (isHorizonUnavailable(error)) {
        throw error;
      }
      throw new Error(`Transaction not found: ${error.message}`);
    }
  }

  /**
   * Stream payments for a specific account
   */
  streamPayments(
    publicKey: string,
    onPayment: (payment: PaymentRecord) => void,
    onError?: (error: Error) => void
  ) {

    const closeHandler = server
      .payments()
      .forAccount(publicKey)
      .cursor('now')
      .stream({
        onmessage: async (record: any) => {
          try {
            const normalized = normalizePaymentOperation(record);
            if (normalized && destinationMatches(normalized.to, publicKey)) {
              // Get transaction to retrieve memo
              const transaction = await horizonCall(
                () => server.transactions().transaction(record.transaction_hash).call(),
                { label: 'streamPayments tx lookup' }
              );

              const payment: PaymentRecord = {
                id: record.id,
                txHash: record.transaction_hash,
                from: normalized.from,
                to: normalized.to,
                amount: normalized.amount,
                assetCode: normalized.assetType === 'native' ? 'XLM' : (normalized.assetCode ?? 'UNKNOWN'),
                assetIssuer: normalized.assetType === 'native' ? undefined : normalized.assetIssuer,
                operationType: normalized.type,
                memo: transaction.memo || undefined,
                memoType: transaction.memo_type || undefined,
                ledger: transaction.ledger_attr,
                createdAt: record.created_at,
              };

              onPayment(payment);
            }
          } catch (error: any) {
            emitOperationalFailure('stellar.streamPayment');
            if (onError) onError(error);
          }
        },
        onerror: (error: any) => {
          emitOperationalFailure('stellar.stream');
          if (onError) onError(error);
        },
      });

    return closeHandler;
  }

  /**
   * Read one ascending Horizon page. Every record is returned, including
   * non-payment and outgoing records, so callers can checkpoint the exact
   * paging token without repeatedly scanning irrelevant operations.
   */
  async getPaymentsPage(
    publicKey: string,
    cursor: string,
    limit: number = 100
  ): Promise<PaymentPageRecord[]> {
    // The operations feed includes claimable balances; its paging tokens share
    // the payment feed's operation ordering, so existing checkpoints remain valid.
    const page = await horizonCall(
      () => server.operations().forAccount(publicKey).cursor(cursor).order('asc').limit(limit).call(),
      { label: 'getPaymentsPage' }
    );

    const records: PaymentPageRecord[] = [];
    const transactions = new Map<string, any>();
    for (const record of page.records as any[]) {
      const pagingToken = String(record.paging_token ?? record.id);
      const base: PaymentPageRecord = { pagingToken };
      const normalized = normalizePaymentOperation(record);
      const unsupportedTo = record.type === 'create_account' ? record.account
        : record.type === 'account_merge' ? record.into ?? record.to : undefined;
      const claimant = record.type === 'create_claimable_balance'
        ? record.claimants?.find((entry: any) => entry.destination === publicKey) : undefined;
      if (!(normalized && destinationMatches(normalized.to, publicKey))
          && !(unsupportedTo && destinationMatches(unsupportedTo, publicKey)) && !claimant) {
        records.push(base);
        continue;
      }

      let transaction = transactions.get(record.transaction_hash);
      if (!transaction) {
        transaction = await horizonCall(
          () => server.transactions().transaction(record.transaction_hash).call(),
          { label: 'getPaymentsPage tx lookup' }
        );
        transactions.set(record.transaction_hash, transaction);
      }
      const ledger = Number(transaction.ledger_attr ?? transaction.ledger);
      base.ledger = Number.isFinite(ledger) ? ledger : undefined;

      if (claimant) {
        // Horizon's create operation omits balance_id. Its immutable creation
        // effect supplies the actual id, including after a balance is claimed.
        if (transaction.memo) {
          const effects = await horizonCall(
            () => server.effects().forOperation(String(record.id)).limit(200).call(),
            { label: 'claimable balance creation effects' }
          );
          const effect = (effects.records as any[]).find((entry) => entry.type === 'claimable_balance_created');
          if (!effect?.balance_id) throw new Error('Claimable balance creation effect is unavailable');
          base.claimableBalance = {
            balanceId: effect.balance_id,
            txHash: record.transaction_hash,
            claimant: publicKey,
            memo: transaction.memo,
            memoType: transaction.memo_type,
            amount: record.amount,
            asset: record.asset,
            predicate: claimant.predicate,
          };
        }
      } else {
        base.payment = {
          id: String(record.id),
          txHash: record.transaction_hash,
          from: normalized?.from ?? record.from ?? record.funder ?? record.source_account,
          to: normalized?.to ?? unsupportedTo,
          amount: normalized?.amount ?? record.starting_balance ?? '',
          assetCode: normalized
            ? normalized.assetType === 'native' ? 'XLM' : (normalized.assetCode ?? 'UNKNOWN')
            : 'XLM',
          assetIssuer: normalized?.assetType === 'native' ? undefined : normalized?.assetIssuer,
          memo: transaction.memo || undefined,
          memoType: transaction.memo_type || undefined,
          ledger: Number.isFinite(ledger) ? ledger : 0,
          createdAt: transaction.created_at ?? record.created_at,
          operationType: record.type,
          transaction,
        };
      }
      records.push(base);
    }
    return records;
  }

  /** Anchor a brand-new monitor at the latest known operation. */
  async getLatestPaymentCursor(publicKey: string): Promise<string> {
    const page = await horizonCall(
      () => server.operations().forAccount(publicKey).order('desc').limit(1).call(),
      { label: 'getLatestPaymentCursor' }
    );
    const latest = (page.records as any[])[0];
    return latest ? String(latest.paging_token ?? latest.id) : '0';
  }

  /**
   * Get recent payments for an account
   */
  async getRecentPayments(publicKey: string, limit: number = 10): Promise<PaymentRecord[]> {
    try {
      const payments = await horizonCall(
        () =>
          server
            .payments()
            .forAccount(publicKey)
            .order('desc')
            .limit(limit)
            .call(),
        { label: 'getRecentPayments page' }
      );

      const paymentRecords: PaymentRecord[] = [];

      for (const record of payments.records) {
        const normalized = normalizePaymentOperation(record);
        if (normalized) {
          const transaction = await horizonCall(
            () => server.transactions().transaction(record.transaction_hash).call(),
            { label: 'getRecentPayments tx lookup' }
          );

          paymentRecords.push({
            id: record.id,
            txHash: record.transaction_hash,
            from: normalized.from,
            to: normalized.to,
            amount: normalized.amount,
            assetCode: normalized.assetType === 'native' ? 'XLM' : (normalized.assetCode ?? 'UNKNOWN'),
            assetIssuer: normalized.assetType === 'native' ? undefined : normalized.assetIssuer,
            operationType: normalized.type,
            memo: transaction.memo || undefined,
            memoType: transaction.memo_type || undefined,
            ledger: transaction.ledger_attr,
            createdAt: record.created_at,
          });
        }
      }

      return paymentRecords;
    } catch (error: any) {
      emitOperationalFailure('stellar.payments');
      throw new Error(`Failed to fetch payments: ${error.message}`);
    }
  }

  /**
   * Create and submit a payment transaction
   */
  async sendPayment(
    destination: string,
    amount: string,
    memo: string,
    assetCode: string = 'XLM',
    assetIssuer?: string
  ): Promise<string> {
    try {
      if (!fitsStellarTextMemo(memo)) {
        throw new Error('memo exceeds the 28-byte Stellar text memo limit');
      }
      const sourceKeypair = getSellerKeypair();
      const sourceAccount = await this.loadAccount(sourceKeypair.publicKey());

      const asset = assetCode === 'XLM'
        ? StellarSdk.Asset.native()
        : new StellarSdk.Asset(assetCode, assetIssuer!);

      const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
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

      transaction.sign(sourceKeypair);

      const result = await horizonCall(() => server.submitTransaction(transaction), {
        label: 'submitTransaction',
      });
      return result.hash;
    } catch (error: any) {
      emitOperationalFailure('stellar.submit');
      throw new Error(`Payment failed: ${error.message}`);
    }
  }
}

export default new StellarService();
