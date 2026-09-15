import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeApiUrl,
  parseConfig,
  printReviewerSummary,
  DEFAULT_API_URL,
  DEFAULT_HORIZON_URL,
  DEFAULT_TESTNET_SELLER,
} from '../backend/scripts/testnet-smoke.mjs';

describe('Testnet Smoke Configuration & URL Normalization', () => {
  it('normalizes various input URLs cleanly', () => {
    assert.equal(normalizeApiUrl('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
    assert.equal(normalizeApiUrl('http://127.0.0.1:3001/'), 'http://127.0.0.1:3001');
    assert.equal(normalizeApiUrl('http://127.0.0.1:3001/api'), 'http://127.0.0.1:3001');
    assert.equal(normalizeApiUrl('http://127.0.0.1:3001/api/'), 'http://127.0.0.1:3001');
    assert.equal(normalizeApiUrl('https://staging.quittance.example/api'), 'https://staging.quittance.example');
    assert.equal(normalizeApiUrl('localhost:3001'), 'http://localhost:3001');
    assert.equal(normalizeApiUrl(''), DEFAULT_API_URL);
  });

  it('parses defaults from environment', () => {
    const config = parseConfig([], {
      SMOKE_API_URL: 'http://127.0.0.1:4000',
      SMOKE_SELLER_PUBLIC_KEY: 'GTESTKEY',
      SMOKE_AMOUNT: '10',
    });

    assert.equal(config.apiUrl, 'http://127.0.0.1:4000');
    assert.equal(config.sellerPublicKey, 'GTESTKEY');
    assert.equal(config.amount, '10');
    assert.equal(config.horizonUrl, DEFAULT_HORIZON_URL);
    assert.equal(config.showHelp, false);
  });

  it('overrides environment variables with CLI arguments', () => {
    const config = parseConfig(
      [
        '--api-url', 'http://127.0.0.1:5000/api',
        '--seller', 'GCLIKEY',
        '--payer-secret', 'SCLIPAYER',
        '--fixture-tx-hash', 'c'.repeat(64),
        '--amount', '3.5',
        '--simulate',
      ],
      {
        SMOKE_API_URL: 'http://127.0.0.1:4000',
        SMOKE_SELLER_PUBLIC_KEY: 'GENVKEY',
      }
    );

    assert.equal(config.apiUrl, 'http://127.0.0.1:5000');
    assert.equal(config.sellerPublicKey, 'GCLIKEY');
    assert.equal(config.payerSecret, 'SCLIPAYER');
    assert.equal(config.fixtureTxHash, 'c'.repeat(64));
    assert.equal(config.amount, '3.5');
    assert.equal(config.simulate, true);
  });

  it('detects help flags', () => {
    assert.equal(parseConfig(['--help'], {}).showHelp, true);
    assert.equal(parseConfig(['-h'], {}).showHelp, true);
  });

  it('prints formatted reviewer summary without throwing', () => {
    const summary = {
      invoiceId: 'inv-12345',
      status: 'PAID',
      paymentUrl: 'http://localhost:3001/pay/inv-12345',
      amount: '1',
      memo: 'TEST-MEMO',
      txHash: 'e'.repeat(64),
      explorerUrl: `https://stellar.expert/explorer/testnet/tx/${'e'.repeat(64)}`,
    };

    let output = '';
    const originalLog = console.log;
    try {
      console.log = (msg) => { output += msg + '\n'; };
      printReviewerSummary(summary);
    } finally {
      console.log = originalLog;
    }

    assert.ok(output.includes('TESTNET SMOKE TEST SUMMARY'));
    assert.ok(output.includes('Invoice ID:       inv-12345'));
    assert.ok(output.includes('Status:           PAID'));
    assert.ok(output.includes('Amount:           1 XLM'));
    assert.ok(output.includes('Transaction Hash: ' + 'e'.repeat(64)));
    assert.ok(output.includes('Stellar Explorer: https://stellar.expert/explorer/testnet/tx/'));
  });
});
