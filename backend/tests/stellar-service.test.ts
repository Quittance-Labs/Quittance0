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

  it('returns TRANSACTION_NOT_FOUND for a confirmed Horizon 404', async (t) => {
    t.mock.method(stellarService, 'getTransaction', async () => {
      throw Object.assign(new Error('Horizon response'), { response: { status: 404 } });
    });
    const result = await stellarService.verifyPayment(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      { memo: 'INV-123', amount: 10, destination: 'GABC', assetCode: 'XLM' },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'TRANSACTION_NOT_FOUND');
  });

  it('returns VERIFY_UNAVAILABLE for a confirmed Horizon 503', async (t) => {
    t.mock.method(stellarService, 'getTransaction', async () => {
      throw Object.assign(new Error('Horizon response'), { response: { status: 503 } });
    });
    const result = await stellarService.verifyPayment(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      { memo: 'INV-123', amount: 10, destination: 'GABC', assetCode: 'XLM' },
    );
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'VERIFY_UNAVAILABLE');
  });
});
