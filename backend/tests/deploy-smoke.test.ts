import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const SELLER = 'G' + 'A'.repeat(55);

describe('deployed MVP smoke contract', () => {
  let server: Server;
  let baseUrl: string;

  before(async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://quittance.example';
    process.env.FRONTEND_URLS = 'https://preview.quittance.example';
    process.env.ALLOW_SIMULATE = 'false';
    process.env.STELLAR_NETWORK = 'TESTNET';
    process.env.STELLAR_HORIZON_URL = 'https://horizon-testnet.stellar.org';

    const { default: app } = await import('../src/server-mvp.ts');
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('passes liveness and readiness with production-safe config', async () => {
    const health = await fetch(`${baseUrl}/api/health`);
    const ready = await fetch(`${baseUrl}/api/ready`);
    assert.equal(health.status, 200);
    assert.equal((await health.json() as any).status, 'ok');
    assert.equal(ready.status, 200);
    assert.equal((await ready.json() as any).ready, true);
  });

  it('allows the deployed frontend origin and rejects an unknown origin', async () => {
    const allowed = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: 'https://quittance.example' },
    });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://quittance.example');

    const denied = await fetch(`${baseUrl}/api/health`, {
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(denied.status, 403);
    assert.equal((await denied.json() as any).code, 'CORS_ORIGIN_DENIED');
  });

  it('creates and reads an invoice through the public HTTP contract', async () => {
    const createdResponse = await fetch(`${baseUrl}/api/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://quittance.example' },
      body: JSON.stringify({
        amount: 1,
        assetCode: 'XLM',
        description: 'Deploy smoke invoice',
        sellerPublicKey: SELLER,
      }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json() as any;
    assert.equal(created.data.invoice.status, 'PENDING');

    const fetched = await fetch(`${baseUrl}/api/invoices/${created.data.invoice.id}`, {
      headers: { origin: 'https://quittance.example' },
    });
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json() as any).data.id, created.data.invoice.id);
  });

  it('keeps simulate-payment hidden in production', async () => {
    const response = await fetch(`${baseUrl}/api/invoices/missing/simulate-payment`, {
      method: 'POST',
      headers: { origin: 'https://quittance.example' },
    });
    assert.equal(response.status, 404);
  });
});
