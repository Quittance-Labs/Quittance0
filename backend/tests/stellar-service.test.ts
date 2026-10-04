import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import stellarService from '../src/services/stellar.service';
import { server } from '../src/config/stellar';

describe('StellarService - Horizon Read Consolidation', () => {
  it('exposes loadAccount, getBalance, verifyPayment, getTransaction, streamPayments, getRecentPayments, sendPayment', () => {
    assert.equal(typeof stellarService.loadAccount, 'function');
    assert.equal(typeof stellarService.getBalance, 'function');
    assert.equal(typeof stellarService.verifyPayment, 'function');
    assert.equal(typeof stellarService.getTransaction, 'function');
    assert.equal(typeof stellarService.streamPayments, 'function');
    assert.equal(typeof stellarService.getRecentPayments, 'function');
    assert.equal(typeof stellarService.sendPayment, 'function');
  });

  it('verifies payment through Horizon data structure and returns failure for invalid hash', async () => {
    const result = await stellarService.verifyPayment('invalid-hash', {
      memo: 'INV-123',
      amount: 10,
      destination: 'GABC',
      assetCode: 'XLM',
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'INVALID_TX_HASH');
    }
  });

  it('returns TRANSACTION_NOT_FOUND when Horizon responds with HTTP 404 for a valid hash', async () => {
    const nonExistentHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const originalTransactions = server.transactions;
    const transactionBuilder = originalTransactions.call(server);
    const originalTransaction = transactionBuilder.transaction;
    const requestedHashes: string[] = [];
    let calls = 0;

    // Keep the service and Horizon wrapper real; control only the SDK response.
    transactionBuilder.transaction = (txHash: string) => {
      requestedHashes.push(txHash);
      const transaction = originalTransaction.call(transactionBuilder, txHash);
      transaction.call = async () => {
        calls += 1;
        throw Object.assign(new Error('Horizon 404'), {
          response: { status: 404, statusText: '404', headers: {} },
        });
      };
      return transaction;
    };
    server.transactions = () => transactionBuilder;

    try {
      const result = await stellarService.verifyPayment(nonExistentHash, {
        memo: 'INV-123',
        amount: 10,
        destination: 'GABC',
        assetCode: 'XLM',
      });

      assert.deepEqual(requestedHashes, [nonExistentHash]);
      assert.equal(calls, 1);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, 'TRANSACTION_NOT_FOUND');
      }
    } finally {
      server.transactions = originalTransactions;
    }
  });
});
