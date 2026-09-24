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
