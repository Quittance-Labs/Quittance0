/**
 * Integration test for the core Quittance loop:
 *
 *   create invoice -> pay on Stellar -> verify -> status PAID
 *
 * Horizon is not called for real. `STELLAR_HORIZON_URL` is pointed at a local
 * stub that answers the two endpoints the verify path uses, so the whole
 * server — routing, validation, the Stellar service and the in-memory store —
 * runs exactly as it does in production, with only the network replaced.
 *
 * The stub must exist before the app is imported, because
 * `config/stellar.ts` builds its Horizon client at module load.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Application } from 'express';

const SELLER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const PAYER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const TX_HASH = 'a'.repeat(64);

/** Whatever the current stub should answer with, swapped per test. */
let horizonResponder: (path: string) => { status: number; body: unknown };

let horizon: http.Server;
let app: Application;

function jsonRequest(
  port: number,
  method: string,
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }
          : {},
      },
      (response) => {
        let raw = '';
        response.on('data', (chunk) => (raw += chunk));
        response.on('end', () => {
          try {
            resolve({ status: response.statusCode ?? 0, body: raw ? JSON.parse(raw) : null });
          } catch {
            resolve({ status: response.statusCode ?? 0, body: raw });
          }
        });
      }
    );
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

/** A Horizon transaction/operations pair describing one successful payment. */
function paymentOn(overrides: {
  memo?: string;
  amount?: string;
  to?: string;
  assetType?: string;
  assetCode?: string;
}) {
  return (path: string) => {
    if (path.startsWith(`/transactions/${TX_HASH}/operations`)) {
      return {
        status: 200,
        body: {
          _embedded: {
            records: [
              {
                id: '1',
                type: 'payment',
                from: PAYER,
                to: overrides.to ?? SELLER,
                amount: overrides.amount ?? '25.0000000',
                asset_type: overrides.assetType ?? 'native',
                ...(overrides.assetCode ? { asset_code: overrides.assetCode } : {}),
              },
            ],
          },
        },
      };
    }

    if (path.startsWith(`/transactions/${TX_HASH}`)) {
      return {
        status: 200,
        body: {
          hash: TX_HASH,
          successful: true,
          ledger: 1_000_000,
          memo: overrides.memo,
          memo_type: 'text',
          created_at: '2026-01-01T00:00:00Z',
        },
      };
    }

    return { status: 404, body: { title: 'Resource Missing' } };
  };
}

async function createInvoice(port: number, amount = 25) {
  const created = await jsonRequest(port, 'POST', '/api/invoices', {
    amount,
    assetCode: 'XLM',
    description: 'Integration test invoice',
    sellerPublicKey: SELLER,
  });

  assert.equal(created.status, 201, `invoice creation failed: ${JSON.stringify(created.body)}`);
  return created.body.data.invoice as { id: string; memo: string; status: string };
}

describe('invoice payment loop', () => {
  let port: number;
  let api: http.Server;

  before(async () => {
    horizon = http.createServer((req, res) => {
      const { status, body } = horizonResponder(req.url ?? '');
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });

    await new Promise<void>((resolve, reject) => {
      horizon.once('error', reject);
      horizon.listen(0, '127.0.0.1', resolve);
    });
    const horizonPort = (horizon.address() as AddressInfo).port;

    // Must be set before the app (and therefore config/stellar.ts) is imported,
    // because the Horizon client is built at module load.
    process.env.STELLAR_HORIZON_URL = `http://127.0.0.1:${horizonPort}`;
    process.env.STELLAR_NETWORK = 'TESTNET';

    ({ default: app } = await import('../src/server-mvp'));

    api = await new Promise<http.Server>((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
    port = (api.address() as AddressInfo).port;
  });

  after(async () => {
    await new Promise<void>((resolve) => api.close(() => resolve()));
    await new Promise<void>((resolve) => horizon.close(() => resolve()));
  });

  it('marks an invoice PAID when the transaction matches', async () => {
    const invoice = await createInvoice(port);
    assert.equal(invoice.status, 'PENDING');

    horizonResponder = paymentOn({ memo: invoice.memo });

    const verified = await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
      txHash: TX_HASH,
    });

    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    assert.equal(verified.body.data.status, 'PAID');
    assert.equal(verified.body.data.paymentTxHash, TX_HASH);

    const fetched = await jsonRequest(port, 'GET', `/api/invoices/${invoice.id}`);
    assert.equal(fetched.body.data.status, 'PAID');
  });

  it('stores payer details supplied with the verification', async () => {
    const invoice = await createInvoice(port);
    horizonResponder = paymentOn({ memo: invoice.memo });

    const verified = await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
      txHash: TX_HASH,
      payerName: 'Ada Lovelace',
      payerEmail: 'ada@example.com',
    });

    assert.equal(verified.status, 200);
    assert.equal(verified.body.data.payerName, 'Ada Lovelace');
    assert.equal(verified.body.data.payerEmail, 'ada@example.com');
  });

  it('refuses a transaction whose memo belongs to another invoice', async () => {
    const invoice = await createInvoice(port);
    horizonResponder = paymentOn({ memo: 'someone-elses-memo' });

    const verified = await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
      txHash: TX_HASH,
    });

    assert.equal(verified.status, 400);
    assert.match(verified.body.error, /memo/i);

    const fetched = await jsonRequest(port, 'GET', `/api/invoices/${invoice.id}`);
    assert.equal(fetched.body.data.status, 'PENDING', 'a rejected verify must not mark it paid');
  });

  it('refuses a payment sent to a different account', async () => {
    const invoice = await createInvoice(port);
    horizonResponder = paymentOn({ memo: invoice.memo, to: PAYER });

    const verified = await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
      txHash: TX_HASH,
    });

    assert.equal(verified.status, 400);
    assert.match(verified.body.error, /destination/i);
  });

  it('refuses a payment for the wrong amount', async () => {
    const invoice = await createInvoice(port, 25);
    horizonResponder = paymentOn({ memo: invoice.memo, amount: '24.9999999' });

    const verified = await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
      txHash: TX_HASH,
    });

    assert.equal(verified.status, 400);
    assert.match(verified.body.error, /amount/i);
  });

  it('refuses a payment in the wrong asset', async () => {
    const invoice = await createInvoice(port);
    horizonResponder = paymentOn({
      memo: invoice.memo,
      assetType: 'credit_alphanum4',
      assetCode: 'USDC',
    });

    const verified = await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
      txHash: TX_HASH,
    });

    assert.equal(verified.status, 400);
    assert.match(verified.body.error, /asset/i);
  });

  it('refuses a second verification of an already paid invoice', async () => {
    const invoice = await createInvoice(port);
    horizonResponder = paymentOn({ memo: invoice.memo });

    const first = await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
      txHash: TX_HASH,
    });
    assert.equal(first.status, 200);

    const second = await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
      txHash: TX_HASH,
    });

    assert.equal(second.status, 400);
    assert.match(second.body.error, /already been paid/i);
  });

  it('requires a transaction hash', async () => {
    const invoice = await createInvoice(port);

    const verified = await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, {});

    assert.equal(verified.status, 400);
    assert.match(verified.body.error, /hash is required/i);
  });

  it('rejects an invalid payer email before touching Horizon', async () => {
    const invoice = await createInvoice(port);
    horizonResponder = () => {
      throw new Error('Horizon must not be called for invalid payer details');
    };

    const verified = await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, {
      txHash: TX_HASH,
      payerEmail: 'not-an-email',
    });

    assert.equal(verified.status, 400);
    assert.match(verified.body.error, /email is invalid/i);
  });

  it('returns 404 for an unknown invoice', async () => {
    const verified = await jsonRequest(
      port,
      'POST',
      '/api/invoices/00000000-0000-0000-0000-000000000000/verify',
      { txHash: TX_HASH }
    );

    assert.equal(verified.status, 404);
  });

  it("counts a paid invoice in the seller's stats", async () => {
    const invoice = await createInvoice(port, 12);
    horizonResponder = paymentOn({ memo: invoice.memo, amount: '12.0000000' });

    await jsonRequest(port, 'POST', `/api/invoices/${invoice.id}/verify`, { txHash: TX_HASH });

    const stats = await jsonRequest(
      port,
      'GET',
      `/api/invoices/stats?sellerPublicKey=${SELLER}`
    );

    assert.equal(stats.status, 200);

    // The stats endpoint wraps its single row in an array, mirroring the shape
    // the SQL-backed service returns. Asserting on the real shape here keeps
    // the test honest about the contract the frontend consumes.
    const [summary] = stats.body.data;
    assert.ok(summary.paid_invoices >= 1, 'at least one invoice should be counted as paid');

    // Revenue is grouped per asset, never summed across assets.
    assert.ok(
      summary.revenue_by_asset.XLM >= 12,
      'the paid amount should appear under its own asset code'
    );
  });
});
