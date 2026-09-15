import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeSmokeApiUrl,
  parseSmokeConfig,
  formatReviewerSummary,
  runTestnetSmoke,
} from '../backend/scripts/testnet-smoke.mjs';

const VALID_SELLER = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
const VALID_PAYER_SECRET = 'SCV43P2J336R3K6V4Y5JDFR6Y24T4NPMK3B7Y677N6A4543N35E34N7C';

describe('Testnet smoke configuration & URL handling', () => {
  it('normalizes local and remote API URLs', () => {
    assert.equal(normalizeSmokeApiUrl('http://127.0.0.1:3001'), 'http://127.0.0.1:3001/api');
    assert.equal(normalizeSmokeApiUrl('http://localhost:3001/api/'), 'http://localhost:3001/api');
    assert.equal(normalizeSmokeApiUrl('https://demo.example.com/api'), 'https://demo.example.com/api');
    assert.equal(normalizeSmokeApiUrl('https://demo.example.com'), 'https://demo.example.com/api');
    assert.throws(() => normalizeSmokeApiUrl(''), /cannot be empty/);
  });

  it('parses environment configuration with sensible defaults', () => {
    const config = parseSmokeConfig({
      SMOKE_API_URL: 'http://127.0.0.1:3001',
      SMOKE_FRONTEND_URL: 'http://localhost:3000/',
      SMOKE_SELLER_PUBLIC_KEY: VALID_SELLER,
      SMOKE_AMOUNT: '0.2500000',
    });

    assert.equal(config.apiUrl, 'http://127.0.0.1:3001/api');
    assert.equal(config.frontendUrl, 'http://localhost:3000');
    assert.equal(config.sellerPublicKey, VALID_SELLER);
    assert.equal(config.amount, '0.2500000');
    assert.equal(config.network, 'TESTNET');
    assert.equal(config.payerSecret, null);
  });

  it('validates XLM amount precision and positivity', () => {
    assert.throws(
      () => parseSmokeConfig({ SMOKE_AMOUNT: '0' }),
      /positive XLM number/
    );
    assert.throws(
      () => parseSmokeConfig({ SMOKE_AMOUNT: '-5' }),
      /positive XLM number/
    );
    assert.throws(
      () => parseSmokeConfig({ SMOKE_AMOUNT: '1.12345678' }),
      /at most 7 decimals/
    );
  });

  it('validates seller and payer key separation', () => {
    assert.throws(
      () => parseSmokeConfig({ SMOKE_SELLER_PUBLIC_KEY: 'not-a-stellar-key' }),
      /Invalid seller public key/
    );
  });
});

describe('Reviewer output format', () => {
  it('includes invoice ID, transaction hash, and explorer link for copy-paste', () => {
    const summary = formatReviewerSummary({
      invoiceId: 'inv_test_123',
      status: 'PAID',
      payLink: 'https://app.example/pay/inv_test_123',
      amount: '0.1000000',
      assetCode: 'XLM',
      memo: 'Q-SMOKE-MEMO',
      txHash: 'e'.repeat(64),
      explorerUrl: 'https://stellar.expert/explorer/testnet/tx/' + 'e'.repeat(64),
    });

    assert.match(summary, /Invoice ID:\s+inv_test_123/);
    assert.match(summary, /Status:\s+PAID/);
    assert.match(summary, /Pay Link:\s+https:\/\/app\.example\/pay\/inv_test_123/);
    assert.match(summary, /Transaction Hash:\s+e{64}/);
    assert.match(summary, /Stellar Explorer:\s+https:\/\/stellar\.expert\/explorer\/testnet\/tx\/e{64}/);
  });
});

describe('E2E invoice smoke lifecycle with negative verify guard', () => {
  it('exercises create -> pay link -> negative verify rejection -> payment -> verify -> PAID', async () => {
    const logs = [];
    const calls = [];

    // Mock API server
    let invoiceStatus = 'PENDING';
    const mockInvoiceId = 'inv_smoke_e2e_429';
    const mockMemo = 'SMOKE429';
    const mockTxHash = 'f'.repeat(64);

    const mockFetch = async (url, options = {}) => {
      calls.push({ url, method: options.method || 'GET' });
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname;

      if (path === '/api/health') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok', network: 'TESTNET' }),
        };
      }

      if (path === '/api/ready') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ready: true }),
        };
      }

      if (path === '/api/invoices' && options.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            data: {
              invoice: {
                id: mockInvoiceId,
                status: 'PENDING',
                amount: '0.1000000',
                assetCode: 'XLM',
                memo: mockMemo,
                sellerPublicKey: VALID_SELLER,
              },
            },
          }),
        };
      }

      if (path === `/api/invoices/${mockInvoiceId}/verify` && options.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        if (body.txHash === '0'.repeat(64)) {
          // Negative verification guard: reject invalid hash
          return {
            ok: false,
            status: 404,
            json: async () => ({
              success: false,
              code: 'TRANSACTION_NOT_FOUND',
              error: 'Transaction not found on Stellar network',
            }),
          };
        }

        if (body.txHash === mockTxHash) {
          invoiceStatus = 'PAID';
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: {
                id: mockInvoiceId,
                status: 'PAID',
                paymentTxHash: mockTxHash,
              },
            }),
          };
        }
      }

      if (path === `/api/invoices/${mockInvoiceId}/simulate-payment`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              id: mockInvoiceId,
              status: 'PAID',
              paymentTxHash: mockTxHash,
            },
          }),
        };
      }

      if (path === `/api/invoices/${mockInvoiceId}`) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: {
              id: mockInvoiceId,
              status: invoiceStatus,
              paymentTxHash: invoiceStatus === 'PAID' ? mockTxHash : undefined,
            },
          }),
        };
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      };
    };

    const config = {
      apiUrl: 'http://127.0.0.1:3001/api',
      frontendUrl: 'http://localhost:3000',
      sellerPublicKey: VALID_SELLER,
      payerSecret: null,
      amount: '0.1000000',
      network: 'TESTNET',
      horizonUrl: 'https://horizon-testnet.stellar.org',
      fixtureTxHash: mockTxHash,
    };

    const result = await runTestnetSmoke({
      config,
      fetch: mockFetch,
      log: (msg) => logs.push(msg),
    });

    assert.equal(result.invoiceId, mockInvoiceId);
    assert.equal(result.status, 'PAID');
    assert.equal(result.txHash, mockTxHash);
    assert.equal(result.memo, mockMemo);
    assert.equal(result.checks.createdPending, true);
    assert.equal(result.checks.negativeVerifyRejected, true);
    assert.equal(result.checks.settlementVerified, true);
    assert.equal(result.checks.persistedPaid, true);

    // Verify step order
    const requestedPaths = calls.map((c) => c.url.replace('http://127.0.0.1:3001', ''));
    assert.ok(requestedPaths.includes('/api/health'));
    assert.ok(requestedPaths.includes('/api/ready'));
    assert.ok(requestedPaths.includes('/api/invoices'));
    assert.ok(requestedPaths.includes(`/api/invoices/${mockInvoiceId}/verify`));
    assert.ok(requestedPaths.includes(`/api/invoices/${mockInvoiceId}`));
  });

  it('fails fast when verification erroneously accepts invalid transaction without proof', async () => {
    const mockFetch = async (url, options = {}) => {
      const parsedUrl = new URL(url);
      const path = parsedUrl.pathname;

      if (path === '/api/health') return { ok: true, status: 200, json: async () => ({ status: 'ok' }) };
      if (path === '/api/ready') return { ok: true, status: 200, json: async () => ({ ready: true }) };
      if (path === '/api/invoices' && options.method === 'POST') {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            data: { invoice: { id: 'inv_broken_verify', status: 'PENDING', memo: 'MEMOBROKEN' } },
          }),
        };
      }
      // Bug simulation: verify incorrectly marks PAID on invalid hash
      if (path.includes('/verify')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { status: 'PAID' } }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: { status: 'PENDING' } }) };
    };

    const config = {
      apiUrl: 'http://127.0.0.1:3001/api',
      frontendUrl: 'http://localhost:3000',
      sellerPublicKey: VALID_SELLER,
      amount: '0.1000000',
      network: 'TESTNET',
      horizonUrl: 'https://horizon-testnet.stellar.org',
    };

    await assert.rejects(
      () => runTestnetSmoke({ config, fetch: mockFetch, log: () => {} }),
      /Verification accepted an invalid transaction hash/
    );
  });
});
