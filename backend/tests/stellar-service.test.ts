import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

let stellarService: typeof import('../src/services/stellar.service')['default'];
let horizon: http.Server;
before(async () => {
  // The CI network is intentionally offline. A missing transaction is a real
  // HTTP404, not a connection refusal; exercise that SDK path locally.
  horizon = http.createServer((_req, res) => {
    res.writeHead(404, { 'content-type': 'application/problem+json' });
    res.end(JSON.stringify({ status: 404, title: 'Resource Missing' }));
  });
  await new Promise<void>(resolve => horizon.listen(0, '127.0.0.1', resolve));
  process.env.STELLAR_HORIZON_URL = `http://127.0.0.1:${(horizon.address() as AddressInfo).port}`;
  ({ default: stellarService } = await import('../src/services/stellar.service'));
});
after(async () => {
  horizon.closeAllConnections();
  await new Promise<void>(resolve => horizon.close(() => resolve()));
});

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
