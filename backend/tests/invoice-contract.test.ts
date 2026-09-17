import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express, { Application } from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import {
  parseInvoiceDto,
  parseCreateInvoiceRequest,
  parseCreateInvoiceResponse,
  parseGetInvoiceResponse,
  parseListInvoicesResponse,
  parsePaymentInfoResponse,
  parseCancelInvoiceResponse,
  parseVerifyPaymentResponse,
  parseGetStatsResponse,
  parseErrorEnvelope,
  INVOICE_OPENAPI_SPEC,
} from '../../shared/invoice-contract';
import { createInvoiceRouter } from '../src/routes/invoice.routes';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { MemoryStorage } from '../src/storage/memory-storage';

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
}

/**
 * Executes an HTTP request against the test server instance.
 * @param port The port the HTTP server is listening on.
 * @param method The HTTP method to execute.
 * @param path The request path including query parameters.
 * @param body Optional JSON body to send.
 * @returns Resolves with status, headers, and parsed body.
 */
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

describe('Invoice API Contract and Schema Verification Suite', () => {
  let server: http.Server;
  let port: number;
  let rawStorage: MemoryStorage;
  let invoiceStorage: MemoryInvoiceStorage;

  const sellerKeypair = Keypair.random();
  const sellerPublicKey = sellerKeypair.publicKey();

  before(async () => {
    rawStorage = new MemoryStorage();
    const service = new InvoiceMemoryService(rawStorage);
    invoiceStorage = new MemoryInvoiceStorage(service);

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
      requireCancelSignature: true,
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

  describe('Contract Schema Invariants and Divergence Detection', () => {
    it('successfully validates and normalizes compliant create invoice requests', () => {
      const valid = {
        amount: 25.5,
        sellerPublicKey,
        assetCode: 'XLM',
        description: 'Design consultation',
      };
      const parsed = parseCreateInvoiceRequest(valid);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.amount, 25.5);
        assert.equal(parsed.data.sellerPublicKey, sellerPublicKey);
        assert.equal(parsed.data.assetCode, 'XLM');
      }
    });

    it('fails when required fields diverge or are omitted', () => {
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
        assert.equal(missingSeller.code, 'VALIDATION_ERROR');
        assert.ok(missingSeller.fieldErrors?.sellerPublicKey);
      }

      const negativeAmount = parseCreateInvoiceRequest({
        amount: -5,
        sellerPublicKey,
        assetCode: 'XLM',
      });
      assert.equal(negativeAmount.success, false);
    });

    it('fails when invoice DTO required fields diverge', () => {
      const brokenInvoice = {
        sellerPublicKey,
        amount: 10,
        assetCode: 'XLM',
      };
      const result = parseInvoiceDto(brokenInvoice);
      assert.equal(result.success, false);
    });

    it('strictly validates shared error envelopes', () => {
      const validEnvelope = {
        success: false,
        error: 'Invoice not found',
        code: 'NOT_FOUND',
      };
      const parsed = parseErrorEnvelope(validEnvelope);
      assert.equal(parsed.success, true);
      if (parsed.success) {
        assert.equal(parsed.data.success, false);
        assert.equal(parsed.data.error, 'Invoice not found');
        assert.equal(parsed.data.code, 'NOT_FOUND');
      }

      const invalidEnvelope1 = parseErrorEnvelope({
        success: true,
        data: {},
      });
      assert.equal(invalidEnvelope1.success, false);

      const invalidEnvelope2 = parseErrorEnvelope({
        success: false,
      });
      assert.equal(invalidEnvelope2.success, false);
    });
  });

  describe('API Endpoint Contract Conformance', () => {
    let createdInvoiceId: string;

    it('enforces contract schema on POST /api/invoices and returns validated response', async () => {
      const payload = {
        amount: 100,
        sellerPublicKey,
        assetCode: 'XLM',
        description: 'Contract test invoice',
      };

      const res = await request(port, 'POST', '/api/invoices', payload);
      assert.equal(res.status, 201);

      const parsedResponse = parseCreateInvoiceResponse(res.body);
      assert.equal(parsedResponse.success, true);
      if (parsedResponse.success) {
        assert.ok(parsedResponse.data.data.invoice.id);
        assert.equal(parsedResponse.data.data.invoice.amount, 100);
        assert.equal(parsedResponse.data.data.invoice.status, 'PENDING');
        createdInvoiceId = parsedResponse.data.data.invoice.id;
      }
    });

    it('rejects invalid create payload with 400 and contract validation envelope', async () => {
      const invalidPayload = {
        amount: 0,
        sellerPublicKey: 'invalid-key',
      };

      const res = await request(port, 'POST', '/api/invoices', invalidPayload);
      assert.equal(res.status, 400);

      const parsedError = parseErrorEnvelope(res.body);
      assert.equal(parsedError.success, true);
      if (parsedError.success) {
        assert.equal(parsedError.data.success, false);
        assert.equal(parsedError.data.code, 'VALIDATION_ERROR');
      }
      assert.ok(res.body.fieldErrors);
    });

    it('conforms to contract on GET /api/invoices/:id', async () => {
      const res = await request(port, 'GET', `/api/invoices/${createdInvoiceId}`);
      assert.equal(res.status, 200);

      const parsedResponse = parseGetInvoiceResponse(res.body);
      assert.equal(parsedResponse.success, true);
      if (parsedResponse.success) {
        assert.equal(parsedResponse.data.data.id, createdInvoiceId);
        assert.equal(parsedResponse.data.data.sellerPublicKey, sellerPublicKey);
      }
    });

    it('conforms to contract on GET /api/invoices listing', async () => {
      const res = await request(port, 'GET', `/api/invoices?sellerPublicKey=${sellerPublicKey}`);
      assert.equal(res.status, 200);

      const parsedResponse = parseListInvoicesResponse(res.body);
      assert.equal(parsedResponse.success, true);
      if (parsedResponse.success) {
        assert.ok(Array.isArray(parsedResponse.data.data));
        assert.ok(parsedResponse.data.data.length >= 1);
        assert.equal(parsedResponse.data.data[0].id, createdInvoiceId);
        assert.ok(parsedResponse.data.pagination);
      }
    });

    it('conforms to contract on GET /api/invoices/:id/payment-info', async () => {
      const res = await request(port, 'GET', `/api/invoices/${createdInvoiceId}/payment-info`);
      assert.equal(res.status, 200);

      const parsedResponse = parsePaymentInfoResponse(res.body);
      assert.equal(parsedResponse.success, true);
      if (parsedResponse.success) {
        assert.ok(parsedResponse.data.data.paymentUrl);
        assert.ok(parsedResponse.data.data.qrCode);
      }
    });

    it('conforms to contract on GET /api/invoices/stats', async () => {
      const res = await request(port, 'GET', `/api/invoices/stats?sellerPublicKey=${sellerPublicKey}`);
      assert.equal(res.status, 200);

      const parsedResponse = parseGetStatsResponse(res.body);
      assert.equal(parsedResponse.success, true);
      if (parsedResponse.success) {
        assert.ok(parsedResponse.data.data.total_invoices >= 1);
        assert.equal(typeof parsedResponse.data.data.paid_invoices, 'number');
      }
    });

    it('conforms to contract on POST /api/invoices/:id/cancel', async () => {
      const signature = sellerKeypair.sign(Buffer.from(createdInvoiceId)).toString('base64');
      const res = await request(port, 'POST', `/api/invoices/${createdInvoiceId}/cancel`, {
        sellerPublicKey,
        signature,
      });

      assert.equal(res.status, 200);
      const parsedResponse = parseCancelInvoiceResponse(res.body);
      assert.equal(parsedResponse.success, true);
      if (parsedResponse.success) {
        assert.equal(parsedResponse.data.data.status, 'CANCELLED');
      }
    });

    it('conforms to contract error envelope on failed verification', async () => {
      const res = await request(port, 'POST', `/api/invoices/${createdInvoiceId}/verify`, {
        txHash: 'a'.repeat(64),
      });

      assert.notEqual(res.status, 200);
      const parsedError = parseErrorEnvelope(res.body);
      assert.equal(parsedError.success, true);
      if (parsedError.success) {
        assert.equal(parsedError.data.success, false);
        assert.ok(parsedError.data.error);
      }
    });
  });

  describe('OpenAPI 3.0.3 Contract Specification Verification', () => {
    it('publishes valid OpenAPI 3.0.3 specification with required metadata', () => {
      assert.equal(INVOICE_OPENAPI_SPEC.openapi, '3.0.3');
      assert.equal(INVOICE_OPENAPI_SPEC.info.title, 'Quittance Invoice API');
      assert.ok(INVOICE_OPENAPI_SPEC.info.version);
    });

    it('defines all required endpoints in paths', () => {
      const paths = INVOICE_OPENAPI_SPEC.paths;
      assert.ok(paths['/invoices'], 'Spec must define /invoices');
      assert.ok(paths['/invoices'].post, 'Spec must define POST /invoices');
      assert.ok(paths['/invoices'].get, 'Spec must define GET /invoices');

      assert.ok(paths['/invoices/{id}'], 'Spec must define /invoices/{id}');
      assert.ok(paths['/invoices/{id}'].get, 'Spec must define GET /invoices/{id}');

      assert.ok(paths['/invoices/{id}/payment-info'], 'Spec must define /invoices/{id}/payment-info');
      assert.ok(paths['/invoices/{id}/payment-info'].get, 'Spec must define GET /invoices/{id}/payment-info');

      assert.ok(paths['/invoices/{id}/cancel'], 'Spec must define /invoices/{id}/cancel');
      assert.ok(paths['/invoices/{id}/cancel'].post, 'Spec must define POST /invoices/{id}/cancel');

      assert.ok(paths['/invoices/{id}/verify'], 'Spec must define /invoices/{id}/verify');
      assert.ok(paths['/invoices/{id}/verify'].post, 'Spec must define POST /invoices/{id}/verify');

      assert.ok(paths['/invoices/stats'], 'Spec must define /invoices/stats');
      assert.ok(paths['/invoices/stats'].get, 'Spec must define GET /invoices/stats');
    });

    it('defines shared component schemas', () => {
      const schemas = INVOICE_OPENAPI_SPEC.components.schemas;
      assert.ok(schemas.InvoiceDto, 'Spec must define InvoiceDto schema');
      assert.ok(schemas.CreateInvoiceRequest, 'Spec must define CreateInvoiceRequest schema');
      assert.ok(schemas.ApiFailure, 'Spec must define ApiFailure schema');
      assert.ok(schemas.ValidationFailureBody, 'Spec must define ValidationFailureBody schema');
      assert.ok(schemas.InvoiceStatsDto, 'Spec must define InvoiceStatsDto schema');
    });
  });
});
