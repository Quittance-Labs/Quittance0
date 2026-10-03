import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { format } from 'node:util';

// Capture every console channel, not just the structured logger's test sink:
// plaintext service/cache/SDK diagnostics must obey the same privacy boundary.
async function captureOutput<T>(action: () => Promise<T>): Promise<{ value: T; output: string; records: any[] }> {
  const lines: string[] = [];
  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const originals = levels.map(level => console[level]);
  for (const level of levels) console[level] = (...args: unknown[]) => { lines.push(format(...args)); };
  try {
    const value = await action();
    return {
      value,
      output: lines.join('\n'),
      records: lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }),
    };
  } finally {
    levels.forEach((level, index) => { console[level] = originals[index]; });
  }
}

const SELLER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const PAYER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const PRIVATE_MARKER = 'private-fixture@example.invalid';
const servers: http.Server[] = [];
let horizon: http.Server;
let horizonResponder: (url: string) => { status: number; body: unknown };
let app: typeof import('../src/server-mvp.ts')['default'];
let port: number;
let sequence = 0;

function request(method: string, path: string, body?: unknown, options: {
  port?: number;
  requestId?: string;
  raw?: boolean;
} = {}): Promise<{ status: number; body: any; requestId?: string }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : options.raw ? String(body) : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: options.port ?? port, method, path, headers: {
      ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
      ...(options.requestId ? { 'x-request-id': options.requestId } : {}),
      'idempotency-key': `log-privacy-${++sequence}`,
    } }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : null, requestId: res.headers['x-request-id'] as string | undefined }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

async function listen(application: typeof app): Promise<number> {
  const server = await new Promise<http.Server>((resolve, reject) => {
    const result = application.listen(0, '127.0.0.1', () => resolve(result));
    result.once('error', reject);
  });
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

function assertPrivate(output: string, values: string[]): void {
  for (const value of [SELLER, PAYER, PRIVATE_MARKER, ...values]) {
    assert.equal(output.includes(value), false, 'operational output exposed a private fixture value');
  }
}

describe('runtime log privacy at real HTTP and service boundaries', () => {
  before(async () => {
    horizonResponder = () => ({ status: 404, body: { status: 404, title: PRIVATE_MARKER } });
    horizon = http.createServer((req, res) => {
      const { status, body } = horizonResponder(req.url ?? '');
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve, reject) => {
      horizon.once('error', reject);
      horizon.listen(0, '127.0.0.1', resolve);
    });
    process.env.NODE_ENV = 'test';
    process.env.INVOICE_STORAGE = 'memory';
    process.env.STELLAR_NETWORK = 'TESTNET';
    process.env.STELLAR_HORIZON_URL = `http://127.0.0.1:${(horizon.address() as AddressInfo).port}`;
    process.env.LOG_FINGERPRINT_KEY = 'local-log-privacy-fixture';
    delete process.env.SELLER_PUBLIC_KEY;
    ({ default: app } = await import('../src/server-mvp.ts'));
    port = await listen(app);
  });

  after(async () => {
    await Promise.all([...servers, horizon].map(server => new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    })));
    const { pool } = await import('../src/config/database.ts');
    await pool.end();
  });

  for (const scenario of ['success', 'rejection', 'outage'] as const) {
    it(`keeps ${scenario} HTTP output private and correlated, including cache replay`, async () => {
      const requestId = `req-${(++sequence).toString(16).padStart(16, '0')}`;
      const txHash = (++sequence).toString(16).padStart(64, '0');
      const capture = await captureOutput(async () => {
        const created = await request('POST', '/api/invoices', {
          amount: 25, assetCode: 'XLM', sellerPublicKey: SELLER,
          description: PRIVATE_MARKER, customerEmail: PRIVATE_MARKER,
        }, { requestId });
        assert.equal(created.status, 201);
        const invoice = created.body.data.invoice;
        horizonResponder = url => {
          if (scenario === 'outage') return { status: 503, body: { status: 503, title: PRIVATE_MARKER, detail: `wallet=${SELLER}` } };
          if (url.endsWith('/operations')) return { status: 200, body: { _embedded: { records: [{
            id: '1', type: 'payment', from: PAYER, to: SELLER, amount: '25.0000000', asset_type: 'native',
          }] } } };
          return { status: 200, body: {
            hash: txHash, successful: true, ledger: 1000000, memo: scenario === 'rejection' ? 'wrong-memo' : invoice.memo,
            memo_type: 'text', created_at: new Date().toISOString(),
          } };
        };
        const get = await request('GET', `/api/invoices/${invoice.id}`, undefined, { requestId });
        const info = await request('GET', `/api/invoices/${invoice.id}/payment-info`, undefined, { requestId });
        const verified = await request('POST', `/api/invoices/${invoice.id}/verify`, { txHash }, { requestId });
        assert.equal(get.status, 200);
        assert.equal(info.status, 200);
        assert.equal(verified.status, scenario === 'success' ? 200 : scenario === 'rejection' ? 400 : 503);
        if (scenario === 'success') assert.equal(verified.body.data.status, 'PAID');
        if (scenario === 'rejection') assert.equal(verified.body.code, 'MEMO_MISMATCH');
        if (scenario === 'outage') assert.equal(verified.body.code, 'VERIFY_UNAVAILABLE');
        for (const response of [created, get, info, verified]) assert.equal(response.requestId, requestId);
        if (scenario !== 'outage') {
          const replay = await request('POST', `/api/invoices/${invoice.id}/verify`, { txHash }, { requestId });
          assert.equal(replay.status, verified.status);
          assert.equal(replay.body.cached, true);
        }
        return invoice;
      });
      assertPrivate(capture.output, [capture.value.id, capture.value.memo, txHash]);
      const lifecycle = capture.records.filter(record => ['invoice.create.started', 'invoice.create.succeeded', 'payment.verify.started', 'invoice.paid', 'payment.verify.rejected', 'horizon.request.failed'].includes(record.event));
      assert.equal(lifecycle.length, 4);
      assert.ok(lifecycle.every(record => record.requestId === requestId));
      const expectedTerminal = scenario === 'success' ? 'invoice.paid' : scenario === 'rejection' ? 'payment.verify.rejected' : 'horizon.request.failed';
      assert.equal(lifecycle.filter(record => record.event === expectedTerminal).length, 1);
      const requests = capture.records.filter(record => record.event === 'http.request.completed');
      assert.equal(requests.length, scenario === 'outage' ? 4 : 5);
      assert.ok(requests.every(record => record.requestId === requestId));
      assert.ok(requests.some(record => record.route === '/invoices/:id/verify'));
      assert.equal(capture.records.filter(record => record.event === 'payment.verify.cached').length, scenario === 'outage' ? 0 : 1);
    });
  }

  for (const entrypoint of ['server-mvp', 'server', 'server-dual'] as const) {
    it(`redacts raw paths and parser Error payloads through ${entrypoint}`, async () => {
      const module = await import(`../src/${entrypoint}.ts`);
      const serverPort = await listen(module.default);
      const capture = await captureOutput(async () => {
        const unknown = await request('GET', `/private/${PRIVATE_MARKER}`, undefined, { port: serverPort });
        const malformed = await request('POST', '/api/invoices', `{"private":"${PRIVATE_MARKER}",invalid}`, { port: serverPort, raw: true });
        assert.equal(unknown.status, 404);
        assert.equal(malformed.status, 500); // Preserve this server's existing failure envelope.
        return { unknown, malformed };
      });
      assertPrivate(capture.output, []);
      const requests = capture.records.filter(record => record.event === 'http.request.completed');
      assert.equal(requests.length, 2);
      assert.ok(requests.every(record => record.route === 'unmatched'));
      const error = capture.records.find(record => record.event === 'operation.failed');
      assert.equal(error?.operation, 'http.request');
      assert.equal(error?.requestId, capture.value.malformed.requestId);
    });
  }

  it('does not serialize account lookup errors or untrusted Horizon response payloads', async () => {
    horizonResponder = () => ({ status: 404, body: { status: 404, title: PRIVATE_MARKER, account: SELLER, transactions: ['f'.repeat(64)] } });
    const { default: stellar } = await import('../src/services/stellar.service.ts');
    const capture = await captureOutput(async () => {
      await assert.rejects(stellar.loadAccount(SELLER));
    });
    assertPrivate(capture.output, ['f'.repeat(64)]);
    assert.equal(capture.records.find(record => record.event === 'operation.failed')?.operation, 'stellar.account');
  });

  it('keeps a failed cache operation visible without the raw key or Error content', async () => {
    const { VerificationCache } = await import('../src/middleware/verify-cache.ts');
    const cache = new VerificationCache();
    (cache as any).getClient = async () => ({ get: async () => { throw new Error(PRIVATE_MARKER); } });
    const capture = await captureOutput(() => cache.get('private-invoice-key', 'e'.repeat(64)));
    assert.equal(capture.value, null);
    assertPrivate(capture.output, ['private-invoice-key', 'e'.repeat(64)]);
    assert.equal(capture.records.find(record => record.event === 'operation.failed')?.operation, 'cache.get');
  });

  it('delivers stream payments without dumping the account or payment history', async () => {
    const { default: stellar } = await import('../src/services/stellar.service.ts');
    const { server } = await import('../src/config/stellar.ts');
    const payments = server.payments;
    let callbacks: any;
    let closed = false;
    const received: any[] = [];
    const builder: any = {
      forAccount: () => builder,
      cursor: () => builder,
      stream: (options: any) => { callbacks = options; return () => { closed = true; }; },
    };
    server.payments = () => builder;
    horizonResponder = () => ({ status: 200, body: { hash: 'd'.repeat(64), memo: 'private-stream-memo', memo_type: 'text', ledger_attr: 1000000 } });
    try {
      const capture = await captureOutput(async () => {
        const close = stellar.streamPayments(SELLER, payment => { received.push(payment); });
        await callbacks.onmessage({ id: 'private-payment-id', type: 'payment', transaction_hash: 'd'.repeat(64), from: PAYER, to: SELLER, amount: '25.0000000', asset_type: 'native', created_at: new Date().toISOString() });
        close();
      });
      assert.equal(received.length, 1);
      assert.equal(received[0].to, SELLER);
      assert.equal(received[0].memo, 'private-stream-memo');
      assert.equal(closed, true);
      assertPrivate(capture.output, ['private-payment-id', 'private-stream-memo', 'd'.repeat(64)]);
    } finally {
      server.payments = payments;
    }
  });

  it('does not dump database exception details while preserving the create failure', async () => {
    const { InvoiceService } = await import('../src/services/invoice.service.ts');
    const service = new InvoiceService({ query: async () => { throw Object.assign(new Error(PRIVATE_MARKER), {
      detail: `seller=${SELLER}`, query: 'private SQL fixture',
    }); } });
    const capture = await captureOutput(async () => {
      await assert.rejects(service.createInvoice({ amount: 25, assetCode: 'XLM', sellerPublicKey: SELLER, expiresInDays: 7 } as any));
    });
    assertPrivate(capture.output, ['private SQL fixture']);
    assert.equal(capture.records.find(record => record.event === 'operation.failed')?.operation, 'invoice.create');
  });
});
