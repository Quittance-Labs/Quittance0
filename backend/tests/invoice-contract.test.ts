/**
 * Invoice API contract suite (issue #446).
 *
 * Pins shared request/response parsers and OpenAPI required fields, then
 * exercises the in-memory MVP router so create/list/get/payment-info/stats
 * envelopes stay aligned with shared/invoice-contract.ts.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { type Application } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import {
  REQUIRED_INVOICE_DTO_FIELDS,
  INVOICE_OPENAPI_SPEC,
  parseInvoiceDto,
  parseCreateInvoiceRequest,
  parseCreateInvoiceResponse,
  parseGetInvoiceResponse,
  parseListInvoicesResponse,
  parsePaymentInfoResponse,
  parseCancelInvoiceResponse,
  parseGetStatsResponse,
  parseErrorEnvelope,
} from '../../shared/invoice-contract';
import { createInvoiceRouter } from '../src/routes/invoice.routes';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';

describe('Statistics response contract', () => {
  const stats = {
    total_invoices: 4,
    paid_invoices: 1,
    pending_invoices: 3,
    actionable_invoices: 0,
    expired_invoices: 0,
    revenue_by_asset: { XLM: 0.0000001, USDC: 25.5 },
  };
  const shapes = {
    bare: (data: unknown) => data,
    object: (data: unknown) => ({ success: true, data }),
    storage: (data: unknown) => ({ success: true, data: [data] }),
  };
  const schema = INVOICE_OPENAPI_SPEC.components.schemas.InvoiceStatsDto;

  for (const [name, wrap] of Object.entries(shapes)) {
    it(`preserves explicit zero counts in the ${name} shape`, () => {
      const parsed = parseGetStatsResponse(wrap(stats));
      assert.equal(parsed.success, true);
      if (parsed.success) assert.deepEqual(parsed.data.data, stats);
    });
  }

  for (const field of schema.required) {
    it(`rejects missing required statistic ${field}`, () => {
      const incomplete: Record<string, unknown> = { ...stats };
      delete incomplete[field];
      for (const wrap of Object.values(shapes)) {
        assert.equal(parseGetStatsResponse(wrap(incomplete)).success, false);
      }
    });
  }

  for (const field of schema.required.filter((field) => field !== 'revenue_by_asset')) {
    it(`rejects malformed ${field} instead of coercing it`, () => {
      for (const value of [undefined, null, '', '0', 'invalid', false, true, [], {}, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const parsed = parseGetStatsResponse({ success: true, data: { ...stats, [field]: value } });
        assert.equal(parsed.success, false, `${field} accepted ${String(value)}`);
      }
    });
  }

  it('requires own statistic fields', () => {
    const inherited = Object.create(stats);
    assert.equal(parseGetStatsResponse({ success: true, data: inherited }).success, false);
  });

  it('rejects malformed revenue maps and values', () => {
    for (const revenue of [null, [], '', 1, { XLM: '1' }, { XLM: false }, { XLM: null }, { XLM: -1 }, { XLM: NaN }, { XLM: Infinity }]) {
      assert.equal(
        parseGetStatsResponse({ success: true, data: { ...stats, revenue_by_asset: revenue } }).success,
        false
      );
    }
  });

  it('accepts complete zero statistics and finite fractional revenue', () => {
    const empty = {
      total_invoices: 0,
      paid_invoices: 0,
      pending_invoices: 0,
      actionable_invoices: 0,
      expired_invoices: 0,
      revenue_by_asset: {},
    };
    const parsed = parseGetStatsResponse({ success: true, data: [empty] });
    assert.equal(parsed.success, true);
    if (parsed.success) assert.deepEqual(parsed.data.data, empty);
    assert.equal(parseGetStatsResponse({ ...stats, total_invoices: Number.MAX_SAFE_INTEGER }).success, true);
  });

  it('preserves own asset keys without altering the object prototype', () => {
    const revenue = JSON.parse('{"__proto__":2,"constructor":3,"XLM":0}');
    const parsed = parseGetStatsResponse({ ...stats, revenue_by_asset: revenue });
    assert.equal(parsed.success, true);
    if (parsed.success) {
      assert.deepEqual(parsed.data.data.revenue_by_asset, revenue);
      assert.equal(Object.getPrototypeOf(parsed.data.data.revenue_by_asset), Object.prototype);
    }
  });

  it('rejects incomplete or non-success envelopes', () => {
    for (const success of [undefined, null, false, 0, 1, 'true']) {
      assert.equal(parseGetStatsResponse({ success, data: stats }).success, false);
    }
    assert.equal(parseGetStatsResponse({ data: stats }).success, false);
    assert.equal(parseGetStatsResponse({ ...stats, success: true }).success, false);
    assert.equal(parseGetStatsResponse({ success: true, data: null }).success, false);
  });

  it('rejects missing or ambiguous storage rows', () => {
    for (const data of [[], [stats, stats], [null], [1]]) {
      assert.equal(parseGetStatsResponse({ success: true, data }).success, false);
    }
  });

  it('publishes matching numeric bounds and the one-row storage response', () => {
    for (const field of schema.required.filter((field) => field !== 'revenue_by_asset')) {
      assert.deepEqual(schema.properties[field], {
        type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER,
      });
    }
    assert.deepEqual(schema.properties.revenue_by_asset.additionalProperties, { type: 'number', minimum: 0 });
    assert.deepEqual(INVOICE_OPENAPI_SPEC.components.schemas.GetStatsResponse.properties.data, {
      oneOf: [
        { $ref: '#/components/schemas/InvoiceStatsDto' },
        { type: 'array', minItems: 1, maxItems: 1, items: { $ref: '#/components/schemas/InvoiceStatsDto' } },
      ],
    });
  });
});

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
}

function request(
  port: number,
  method: string,
  path: string,
  body?: unknown
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let payload: Buffer | undefined;
    const headers: Record<string, string | number> = {};

    if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      headers['content-type'] = 'application/json';
      headers['content-length'] = payload.length;
    }

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers,
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: parsed,
          });
        });
      }
    );

    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

describe('Invoice API contract (issue #446)', () => {
  let server: http.Server;
  let port: number;

  const sellerKeypair = Keypair.random();
  const sellerPublicKey = sellerKeypair.publicKey();

  before(async () => {
    const invoiceStorage = new MemoryInvoiceStorage();

    const app: Application = express();
    app.use(express.json());

    const mockStellar = {
      getTransaction: async () => {
        throw new Error('Transaction not found');
      },
    };

    const router = createInvoiceRouter({
      storage: invoiceStorage,
      stellar: mockStellar as any,
      enableRateLimiting: false,
      enableConcurrencyLock: false,
      requireCancelSignature: false,
    });

    app.use('/api', router);

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  describe('schema invariants and divergence detection', () => {
    it('accepts a compliant create invoice request', () => {
      const parsed = parseCreateInvoiceRequest({
        amount: 25.5,
        sellerPublicKey,
        assetCode: 'XLM',
        description: 'Design consultation',
      });
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.amount, 25.5);
        assert.equal(parsed.data.sellerPublicKey, sellerPublicKey);
      }
    });

    it('rejects create payloads when required fields diverge', () => {
      const missingAmount = parseCreateInvoiceRequest({
        sellerPublicKey,
        assetCode: 'XLM',
      });
      assert.equal(missingAmount.success, false);
      if (!missingAmount.success) {
        assert.equal(missingAmount.code, 'VALIDATION_ERROR');
        assert.ok(missingAmount.fieldErrors?.amount);
      }

      const missingSeller = parseCreateInvoiceRequest({
        amount: 10,
        assetCode: 'XLM',
      });
      assert.equal(missingSeller.success, false);
      if (!missingSeller.success) {
        assert.ok(missingSeller.fieldErrors?.sellerPublicKey);
      }

      const negativeAmount = parseCreateInvoiceRequest({
        amount: -5,
        sellerPublicKey,
        assetCode: 'XLM',
      });
      assert.equal(negativeAmount.success, false);
    });

    it('rejects an invoice DTO missing required fields', () => {
      const result = parseInvoiceDto({
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
      });
      assert.equal(result.success, false);
    });

    it('validates the shared error envelope', () => {
      const parsed = parseErrorEnvelope({
        success: false,
        error: 'Invoice not found',
        code: 'NOT_FOUND',
      });
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.error, 'Invoice not found');
        assert.equal(parsed.data.code, 'NOT_FOUND');
      }

      assert.equal(parseErrorEnvelope({ success: true, data: {} }).success, false);
      assert.equal(parseErrorEnvelope({ success: false }).success, false);
    });

    it('keeps OpenAPI InvoiceDto.required aligned with REQUIRED_INVOICE_DTO_FIELDS', () => {
      const openApiRequired = (INVOICE_OPENAPI_SPEC as any).components.schemas
        .InvoiceDto.required as string[];
      assert.deepEqual(
        [...openApiRequired].sort(),
        [...REQUIRED_INVOICE_DTO_FIELDS].sort()
      );
    });

    it('publishes OpenAPI paths for create, get, list, cancel, verify, and stats', () => {
      const paths = (INVOICE_OPENAPI_SPEC as any).paths;
      assert.ok(paths['/invoices']?.post);
      assert.ok(paths['/invoices']?.get);
      assert.ok(paths['/invoices/{id}']?.get);
      assert.ok(paths['/invoices/{id}/payment-info']?.get);
      assert.ok(paths['/invoices/{id}/cancel']?.post);
      assert.ok(paths['/invoices/{id}/verify']?.post);
      assert.ok(paths['/invoices/stats']?.get);
    });
  });

  describe('MVP router contract conformance', () => {
    let createdInvoiceId: string;

    it('POST /api/invoices returns a create envelope that parses', async () => {
      const res = await request(port, 'POST', '/api/invoices', {
        amount: 100,
        sellerPublicKey,
        assetCode: 'XLM',
        description: 'Contract test invoice',
      });
      assert.equal(res.status, 201);

      const parsed = parseCreateInvoiceResponse(res.body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.ok(parsed.data.data.invoice.id);
        assert.equal(parsed.data.data.invoice.amount, 100);
        assert.equal(parsed.data.data.invoice.status, 'PENDING');
        createdInvoiceId = parsed.data.data.invoice.id;
      }
    });

    it('rejects an invalid create payload with the validation envelope', async () => {
      const res = await request(port, 'POST', '/api/invoices', {
        amount: 0,
        sellerPublicKey: 'invalid-key',
      });
      assert.equal(res.status, 400);

      const parsed = parseErrorEnvelope(res.body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.success, false);
        assert.equal(parsed.data.code, 'VALIDATION_ERROR');
        assert.ok(parsed.data.fieldErrors);
      }
    });

    it('GET /api/invoices/:id parses with the shared schema', async () => {
      const res = await request(port, 'GET', `/api/invoices/${createdInvoiceId}`);
      assert.equal(res.status, 200);
      const parsed = parseGetInvoiceResponse(res.body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.data.id, createdInvoiceId);
      }
    });

    it('GET /api/invoices list parses with the shared schema', async () => {
      const res = await request(
        port,
        'GET',
        `/api/invoices?sellerPublicKey=${encodeURIComponent(sellerPublicKey)}`
      );
      assert.equal(res.status, 200);
      const parsed = parseListInvoicesResponse(res.body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.ok(parsed.data.data.length >= 1);
        assert.ok(parsed.data.pagination);
      }
    });

    it('GET payment-info parses with the shared schema', async () => {
      const res = await request(
        port,
        'GET',
        `/api/invoices/${createdInvoiceId}/payment-info`
      );
      assert.equal(res.status, 200);
      const parsed = parsePaymentInfoResponse(res.body);
      assert.equal(parsed.success, true);
    });

    it('GET /api/invoices/stats parses with the shared schema', async () => {
      const res = await request(
        port,
        'GET',
        `/api/invoices/stats?sellerPublicKey=${encodeURIComponent(sellerPublicKey)}`
      );
      assert.equal(res.status, 200);
      const parsed = parseGetStatsResponse(res.body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.ok(parsed.data.data.total_invoices >= 1);
      }
    });

    it('GET /api/invoices/stats preserves a complete empty seller response', async () => {
      const res = await request(
        port,
        'GET',
        `/api/invoices/stats?sellerPublicKey=${encodeURIComponent(Keypair.random().publicKey())}`
      );
      assert.equal(res.status, 200);
      const parsed = parseGetStatsResponse(res.body);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.deepEqual(parsed.data.data, {
          total_invoices: 0,
          paid_invoices: 0,
          pending_invoices: 0,
          actionable_invoices: 0,
          expired_invoices: 0,
          revenue_by_asset: {},
        });
      }
    });

    it('POST cancel returns a cancel envelope that parses', async () => {
      const res = await request(
        port,
        'POST',
        `/api/invoices/${createdInvoiceId}/cancel`,
        { sellerPublicKey }
      );
      assert.ok([200, 400, 401, 403, 409].includes(res.status));
      if (res.status === 200) {
        const parsed = parseCancelInvoiceResponse(res.body);
        assert.equal(parsed.success, true);
        if (parsed.success) {
          assert.equal(parsed.data.data.status, 'CANCELLED');
        }
      } else {
        const parsed = parseErrorEnvelope(res.body);
        assert.equal(parsed.success, true);
      }
    });
  });
});
