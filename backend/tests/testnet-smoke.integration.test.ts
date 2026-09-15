import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { runSmokeTest, normalizeApiUrl, parseConfig } from '../scripts/testnet-smoke.mjs';

const TEST_SELLER = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';

describe('Testnet Smoke Runner Integration Suite', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    process.env.NODE_ENV = 'development';
    process.env.ALLOW_SIMULATE = 'true';
    process.env.STELLAR_NETWORK = 'TESTNET';
    process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';

    const { default: app } = await import('../src/server-mvp.ts');
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('normalizes various API URL patterns', () => {
    assert.equal(normalizeApiUrl('http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
    assert.equal(normalizeApiUrl('http://127.0.0.1:3001/'), 'http://127.0.0.1:3001');
    assert.equal(normalizeApiUrl('http://127.0.0.1:3001/api'), 'http://127.0.0.1:3001');
    assert.equal(normalizeApiUrl('http://127.0.0.1:3001/api/'), 'http://127.0.0.1:3001');
    assert.equal(normalizeApiUrl('localhost:3001'), 'http://localhost:3001');
  });

  it('parses configuration arguments and environment defaults', () => {
    const parsed = parseConfig(
      ['--api-url', 'http://127.0.0.1:8080/api', '--amount', '5', '--simulate'],
      {}
    );
    assert.equal(parsed.apiUrl, 'http://127.0.0.1:8080');
    assert.equal(parsed.amount, '5');
    assert.equal(parsed.simulate, true);
    assert.equal(parsed.showHelp, false);
  });

  it('completes the full end-to-end smoke test workflow in simulated mode', async () => {
    const summary = await runSmokeTest({
      apiUrl: baseUrl,
      sellerPublicKey: TEST_SELLER,
      amount: '2.5',
      simulate: true,
    });

    assert.ok(summary.invoiceId, 'Summary must include invoiceId');
    assert.equal(summary.status, 'PAID');
    assert.ok(summary.paymentUrl.length > 0, 'Summary must include non-empty paymentUrl');
    assert.equal(summary.amount, '2.5');
    assert.ok(summary.memo.length > 0, 'Summary must include memo');
    assert.ok(summary.txHash.length > 0, 'Summary must include txHash');
    assert.ok(summary.explorerUrl.includes(summary.txHash), 'Explorer URL must contain txHash');
  });

  it('fails fast when no payment mechanism is provided', async () => {
    await assert.rejects(
      async () => {
        await runSmokeTest({
          apiUrl: baseUrl,
          sellerPublicKey: TEST_SELLER,
          simulate: false,
          payerSecret: '',
          fixtureTxHash: '',
        });
      },
      /No payment execution method provided/
    );
  });

  it('fails fast when API URL points to unreachable endpoint', async () => {
    await assert.rejects(
      async () => {
        await runSmokeTest({
          apiUrl: 'http://127.0.0.1:1',
          simulate: true,
        });
      }
    );
  });
});
