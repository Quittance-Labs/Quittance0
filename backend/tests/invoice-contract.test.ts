import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import {
  PUBLIC_INVOICE_FIELDS,
  SELLER_ONLY_FIELDS,
  SELLER_INVOICE_FIELDS,
  buildSep0007PayUri,
  toPublicInvoiceDto,
  toSellerInvoiceDto,
} from '../../shared/invoice';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers';

const SELLER_KEY = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const FOREIGN_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

type FakeResponse = {
  statusCode: number;
  body: any;
  status(code: number): FakeResponse;
  json(payload: any): FakeResponse;
};

function createRes(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: any) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function createReq(init: { body?: any; params?: any; query?: any; headers?: any } = {}): Request {
  return {
    body: init.body || {},
    params: init.params || {},
    query: init.query || {},
    headers: init.headers || {},
  } as unknown as Request;
}

async function call(
  handler: (req: Request, res: Response) => Promise<void>,
  req: Request
): Promise<FakeResponse> {
  const res = createRes();
  await handler(req, res);
  return res;
}

describe('invoice contract shapes and drift guards', () => {
  it('strictly isolates seller-only fields from the public invoice field contract', () => {
    for (const sellerField of SELLER_ONLY_FIELDS) {
      assert.equal(
        (PUBLIC_INVOICE_FIELDS as readonly string[]).includes(sellerField),
        false,
        `seller-only field ${sellerField} must not exist in PUBLIC_INVOICE_FIELDS`
      );
    }
  });

  it('guarantees seller invoice fields cover both public and seller-only fields', () => {
    const combined = new Set([...PUBLIC_INVOICE_FIELDS, ...SELLER_ONLY_FIELDS]);
    for (const field of SELLER_INVOICE_FIELDS) {
      assert.ok(combined.has(field), `unexpected field ${field} in SELLER_INVOICE_FIELDS`);
    }
    for (const field of combined) {
      assert.ok(
        (SELLER_INVOICE_FIELDS as readonly string[]).includes(field),
        `field ${field} missing from SELLER_INVOICE_FIELDS`
      );
    }
  });

  it('transforms raw invoice into public DTO without exposing seller-only PII or notes', () => {
    const rawInvoice = {
      id: 'inv-test-contract-1',
      sellerPublicKey: SELLER_KEY,
      sellerName: 'Acme Corp',
      sellerEmail: 'accounting@acme.example',
      customerName: 'Client Alpha',
      customerEmail: 'client@alpha.example',
      payerName: 'John Doe',
      payerEmail: 'john@alpha.example',
      payerPublicKey: FOREIGN_KEY,
      amount: 120.5,
      assetCode: 'USDC',
      assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      memo: 'PAY-12345',
      description: 'Consulting Services',
      status: 'PENDING' as const,
      createdAt: '2026-03-20T10:00:00.000Z',
      expiresAt: '2026-03-25T10:00:00.000Z',
      metadata: { internalNotes: 'High priority customer' },
    };

    const publicDto = toPublicInvoiceDto(rawInvoice);

    assert.equal(publicDto.id, rawInvoice.id);
    assert.equal(publicDto.sellerPublicKey, SELLER_KEY);
    assert.equal(publicDto.destination, SELLER_KEY);
    assert.equal(publicDto.amount, 120.5);
    assert.equal(publicDto.assetCode, rawInvoice.assetCode);
    assert.equal(publicDto.memo, rawInvoice.memo);
    assert.ok(publicDto.paymentUri);
    assert.ok(publicDto.paymentUri.startsWith('web+stellar:pay?'));

    const exposedSellerKeys = Object.keys(publicDto).filter((key) =>
      (SELLER_ONLY_FIELDS as readonly string[]).includes(key)
    );
    assert.deepEqual(exposedSellerKeys, []);

    assert.equal((publicDto as any).customerName, undefined);
    assert.equal((publicDto as any).customerEmail, undefined);
    assert.equal((publicDto as any).sellerEmail, undefined);
    assert.equal((publicDto as any).payerName, undefined);
    assert.equal((publicDto as any).payerEmail, undefined);
    assert.equal((publicDto as any).metadata, undefined);
  });

  it('transforms raw invoice into seller workspace DTO retaining client contact and metadata', () => {
    const rawInvoice = {
      id: 'inv-test-contract-2',
      sellerPublicKey: SELLER_KEY,
      sellerName: 'Acme Corp',
      sellerEmail: 'accounting@acme.example',
      customerName: 'Client Alpha',
      customerEmail: 'client@alpha.example',
      amount: 50,
      assetCode: 'XLM',
      memo: 'PAY-67890',
      status: 'PENDING' as const,
      createdAt: '2026-03-20T10:00:00.000Z',
      expiresAt: '2026-03-25T10:00:00.000Z',
      metadata: { billingCode: 'DEPT-4' },
    };

    const sellerDto = toSellerInvoiceDto(rawInvoice);

    assert.equal(sellerDto.id, rawInvoice.id);
    assert.equal(sellerDto.destination, SELLER_KEY);
    assert.equal(sellerDto.customerName, 'Client Alpha');
    assert.equal(sellerDto.customerEmail, 'client@alpha.example');
    assert.equal(sellerDto.sellerEmail, 'accounting@acme.example');
    assert.deepEqual(sellerDto.metadata, { billingCode: 'DEPT-4' });
    assert.ok(sellerDto.paymentUri.startsWith('web+stellar:pay?'));
  });

  it('builds standard SEP-0007 payment URI with correct query parameters', () => {
    const uri = buildSep0007PayUri({
      destination: SELLER_KEY,
      amount: '45.0000000',
      assetCode: 'USDC',
      assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      memo: 'INV-101',
    });

    assert.ok(uri.startsWith('web+stellar:pay?'));
    const parsed = new URL(uri);
    assert.equal(parsed.protocol, 'web+stellar:');
    assert.equal(parsed.searchParams.get('destination'), SELLER_KEY);
    assert.equal(parsed.searchParams.get('amount'), '45.0000000');
    assert.equal(parsed.searchParams.get('asset_code'), 'USDC');
    assert.equal(
      parsed.searchParams.get('asset_issuer'),
      'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5'
    );
    assert.equal(parsed.searchParams.get('memo'), 'INV-101');
    assert.equal(parsed.searchParams.get('memo_type'), 'MEMO_TEXT');
  });
});

describe('invoice endpoints DTO privacy boundary', () => {
  function setup() {
    const storage = new MemoryInvoiceStorage();
    const handlers = createInvoiceHandlers({
      storage,
      frontendUrl: 'http://localhost:3000',
      allowSimulate: false,
      stellar: { getTransaction: async () => ({}) },
    });
    return { storage, handlers };
  }

  it('serves public DTO without client PII on unauthenticated GET', async () => {
    const { storage, handlers } = setup();

    const created = await storage.createInvoice({
      sellerPublicKey: SELLER_KEY,
      sellerName: 'Acme Invoicing',
      sellerEmail: 'billing@acme.example',
      customerName: 'Sensitive Client Inc',
      customerEmail: 'vip@client.example',
      amount: 500,
      assetCode: 'USDC',
      memo: 'PAY-INV-777',
      metadata: { riskScore: 0.12, notes: 'Do not contact directly' },
    });

    const res = await call(handlers.getInvoice, createReq({ params: { id: created.id } }));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    const data = res.body.data;

    assert.equal(data.id, created.id);
    assert.equal(data.destination, SELLER_KEY);
    assert.equal(data.amount, 500);
    assert.equal(data.memo, created.memo);
    assert.ok(data.paymentUri);

    assert.equal(data.customerEmail, undefined);
    assert.equal('customerEmail' in data, false);
    assert.equal(data.customerName, undefined);
    assert.equal('customerName' in data, false);
    assert.equal(data.metadata, undefined);
    assert.equal('metadata' in data, false);
    assert.equal(data.sellerEmail, undefined);
    assert.equal('sellerEmail' in data, false);
  });

  it('serves public DTO without client PII when a foreign wallet requests GET', async () => {
    const { storage, handlers } = setup();

    const created = await storage.createInvoice({
      sellerPublicKey: SELLER_KEY,
      sellerName: 'Acme Invoicing',
      customerName: 'Sensitive Client Inc',
      customerEmail: 'vip@client.example',
      amount: 500,
      assetCode: 'USDC',
      memo: 'PAY-INV-778',
      metadata: { privateData: true },
    });

    const resWithHeader = await call(
      handlers.getInvoice,
      createReq({
        params: { id: created.id },
        headers: { 'x-seller-public-key': FOREIGN_KEY },
      })
    );

    assert.equal(resWithHeader.statusCode, 200);
    assert.equal(resWithHeader.body.data.customerEmail, undefined);
    assert.equal('customerEmail' in resWithHeader.body.data, false);
    assert.equal(resWithHeader.body.data.customerName, undefined);
    assert.equal('customerName' in resWithHeader.body.data, false);
    assert.equal(resWithHeader.body.data.metadata, undefined);
    assert.equal('metadata' in resWithHeader.body.data, false);

    const resWithQuery = await call(
      handlers.getInvoice,
      createReq({
        params: { id: created.id },
        query: { sellerPublicKey: FOREIGN_KEY },
      })
    );

    assert.equal(resWithQuery.statusCode, 200);
    assert.equal(resWithQuery.body.data.customerEmail, undefined);
    assert.equal('customerEmail' in resWithQuery.body.data, false);
    assert.equal(resWithQuery.body.data.customerName, undefined);
    assert.equal('customerName' in resWithQuery.body.data, false);
  });

  it('serves seller workspace DTO with client contact when owning seller requests GET via header or query', async () => {
    const { storage, handlers } = setup();

    const created = await storage.createInvoice({
      sellerPublicKey: SELLER_KEY,
      sellerName: 'Acme Invoicing',
      sellerEmail: 'billing@acme.example',
      customerName: 'Sensitive Client Inc',
      customerEmail: 'vip@client.example',
      amount: 500,
      assetCode: 'USDC',
      memo: 'PAY-INV-779',
      metadata: { internalNotes: 'Confirmed VIP' },
    });

    const resHeader = await call(
      handlers.getInvoice,
      createReq({
        params: { id: created.id },
        headers: { 'x-seller-public-key': SELLER_KEY },
      })
    );

    assert.equal(resHeader.statusCode, 200);
    assert.equal(resHeader.body.data.customerEmail, 'vip@client.example');
    assert.equal(resHeader.body.data.customerName, 'Sensitive Client Inc');
    assert.equal(resHeader.body.data.sellerEmail, 'billing@acme.example');
    if (created.metadata) {
      assert.deepEqual(resHeader.body.data.metadata, created.metadata);
    }

    const resQuery = await call(
      handlers.getInvoice,
      createReq({
        params: { id: created.id },
        query: { sellerPublicKey: SELLER_KEY },
      })
    );

    assert.equal(resQuery.statusCode, 200);
    assert.equal(resQuery.body.data.customerEmail, 'vip@client.example');
    assert.equal(resQuery.body.data.customerName, 'Sensitive Client Inc');
  });

  it('serves public DTO inside getPaymentInfo payload', async () => {
    const { storage, handlers } = setup();

    const created = await storage.createInvoice({
      sellerPublicKey: SELLER_KEY,
      customerName: 'Public Payer View',
      customerEmail: 'payer-view@example.com',
      amount: 25,
      assetCode: 'XLM',
      memo: 'PAY-INFO-1',
    });

    const res = await call(handlers.getPaymentInfo, createReq({ params: { id: created.id } }));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.invoice);
    assert.equal(res.body.data.invoice.destination, SELLER_KEY);
    assert.equal(res.body.data.invoice.customerEmail, undefined);
    assert.equal('customerEmail' in res.body.data.invoice, false);
    assert.equal(res.body.data.invoice.customerName, undefined);
    assert.equal('customerName' in res.body.data.invoice, false);
  });
});
