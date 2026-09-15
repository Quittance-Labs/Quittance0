import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { runTestnetSmoke, parseSmokeConfig } from '../scripts/testnet-smoke.mjs';

const SELLER = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';

describe('Testnet E2E Smoke Integration against running MVP server', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL = 'https://quittance.example';
    process.env.ALLOW_SIMULATE = 'false';
    process.env.STELLAR_NETWORK = 'TESTNET';
    process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';

    const { default: app } = await import('../src/server-mvp.ts');
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('runs full create -> pay link -> negative verify -> verify -> PAID smoke lifecycle', async () => {
    const logs: string[] = [];
    const config = parseSmokeConfig({
      SMOKE_API_URL: baseUrl,
      SMOKE_FRONTEND_URL: 'https://quittance.example',
      SMOKE_SELLER_PUBLIC_KEY: SELLER,
      SMOKE_AMOUNT: '0.1000000',
      SMOKE_FIXTURE_TX_HASH: 'f'.repeat(64),
    });

    const result = await runTestnetSmoke({
      config,
      log: (msg: string) => logs.push(msg),
    });

    assert.ok(result.invoiceId);
    assert.ok(['PENDING', 'PAID'].includes(result.status));
    assert.equal(result.amount, '0.1000000');
    assert.equal(result.assetCode, 'XLM');
    assert.ok(result.txHash);
    assert.ok(result.payLink.includes(result.invoiceId));
    assert.ok(result.explorerUrl.includes(result.txHash));
    assert.equal(result.checks.health, true);
    assert.equal(result.checks.readiness, true);
    assert.equal(result.checks.createdPending, true);
    assert.equal(result.checks.negativeVerifyRejected, true);

    const logOutput = logs.join('\n');
    assert.match(logOutput, /Step 1: Health & Readiness confirmed/);
    assert.match(logOutput, /Step 2: Invoice created/);
    assert.match(logOutput, /Step 3: Pay link generated/);
    assert.match(logOutput, /Step 4: Negative verification guard passed/);
    assert.match(logOutput, /QUITTANCE TESTNET E2E SMOKE RESULT/);
  });
});
