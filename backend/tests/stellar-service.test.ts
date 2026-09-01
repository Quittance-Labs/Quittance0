import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import stellarService from '../src/services/stellar.service';

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

  it('verifies payment with a non-existent 64-character hash returns TRANSACTION_NOT_FOUND', async () => {
    const nonExistentHash = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const result = await stellarService.verifyPayment(nonExistentHash, {
      memo: 'INV-123',
      amount: 10,
      destination: 'GABC',
      assetCode: 'XLM',
    });

    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, 'TRANSACTION_NOT_FOUND');
    }
  });
});
