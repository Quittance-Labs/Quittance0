import type { PaymentPageSource } from '../../src/services/payment-monitor.service';
import type { HorizonTransactionDetails } from '../../src/services/stellar.service';

/** Supplies transaction envelopes for the existing single-payment page fixtures. */
export function withPaymentTransactions(
  source: Omit<PaymentPageSource, 'getTransaction'>
): PaymentPageSource {
  const transactions = new Map<string, HorizonTransactionDetails>();

  return {
    ...source,
    async getPaymentsPage(...args) {
      const page = await source.getPaymentsPage(...args);
      for (const { payment } of page) {
        // Repeated hashes in cursor tests represent replays, not additional ops.
        if (!payment || transactions.has(payment.txHash)) continue;
        const native = payment.assetCode === 'XLM';
        transactions.set(payment.txHash, {
          transaction: {
            memo: payment.memo ?? null,
            memo_type: payment.memoType ?? (payment.memo ? 'text' : 'none'),
            created_at: payment.createdAt,
          },
          operations: [{
            type: 'payment',
            from: payment.from,
            to: payment.to,
            amount: payment.amount,
            asset_type: native
              ? 'native'
              : payment.assetCode.length <= 4 ? 'credit_alphanum4' : 'credit_alphanum12',
            ...(native ? {} : {
              asset_code: payment.assetCode,
              asset_issuer: payment.assetIssuer,
            }),
          }],
        });
      }
      return page;
    },
    async getTransaction(txHash) {
      const details = transactions.get(txHash);
      if (!details) throw new Error(`No transaction fixture for ${txHash}`);
      return details;
    },
  };
}
