/**
 * Issue #436 - one rule set for the create path.
 *
 * The form used to check two of these fields itself and let the API discover
 * the rest, which meant a payload could pass the form and come back as a 400
 * whose body was a serialised Zod issue list naming no field. These tests pin
 * the two halves together: the shared rule set and the API's validator must
 * reject the same payloads, with the same sentence for the field that broke.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createInvoiceHandlers } from '../src/routes/invoice.handlers.ts';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage.ts';
import { createInvoiceFieldErrors, createInvoiceSchema } from '../src/utils/validation.ts';
import { generateInvoiceMemo, hasInvoiceMemoPrefix, isValidMemo } from '../src/utils/memo.ts';
import {
  CREATE_INVOICE_MESSAGES,
  collectCreateInvoiceFieldErrors,
} from '../../shared/invoice-validation.ts';

const SELLER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ISSUER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amount: 25,
    assetCode: 'XLM',
    expiresInDays: 7,
    sellerPublicKey: SELLER,
    ...overrides,
  };
}

function createRes(): any {
  const res: any = { statusCode: 200, body: null };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  return res;
}

function createReq(init: { body?: unknown } = {}): any {
  return { body: init.body ?? {}, params: {}, query: {} };
}

async function call(handler: (req: any, res: any) => Promise<void>, req: any) {
  const res = createRes();
  await handler(req, res);
  return res;
}

const REJECTED: Array<{ name: string; overrides: Record<string, unknown> }> = [
  { name: 'a missing amount', overrides: { amount: undefined } },
  { name: 'an amount of zero', overrides: { amount: 0 } },
  { name: 'a negative amount', overrides: { amount: -12 } },
  { name: 'an amount sent as text', overrides: { amount: 'twenty-five' } },
  { name: 'an amount past the ceiling', overrides: { amount: 2_000_000_000 } },
  { name: 'a missing seller key', overrides: { sellerPublicKey: undefined } },
  { name: 'a truncated seller key', overrides: { sellerPublicKey: SELLER.slice(0, 40) } },
  { name: 'an issued asset without its issuer', overrides: { assetCode: 'USDC' } },
  {
    name: 'the native asset carrying an issuer',
    overrides: { assetCode: 'XLM', assetIssuer: ISSUER },
  },
  {
    name: 'an issuer that is not a key',
    overrides: { assetCode: 'USDC', assetIssuer: 'not-a-key' },
  },
  { name: 'a client email without a domain', overrides: { customerEmail: 'client@' } },
  { name: 'a seller email with a space', overrides: { sellerEmail: 'me @example.com' } },
  { name: 'a description past the cap', overrides: { description: 'x'.repeat(501) } },
  { name: 'a client name past the cap', overrides: { customerName: 'y'.repeat(256) } },
  { name: 'a payment window of zero days', overrides: { expiresInDays: 0 } },
  { name: 'a payment window past the cap', overrides: { expiresInDays: 31 } },
  { name: 'a fractional payment window', overrides: { expiresInDays: 1.5 } },
  { name: 'a network the API does not run on', overrides: { network: 'SIMNET' } },
];

describe('create-invoice rules - the form and the API agree', () => {
  for (const { name, overrides } of REJECTED) {
    it('rejects ' + name + ' with the same sentence on both sides', () => {
      const body = payload(overrides);
      const fieldErrors = collectCreateInvoiceFieldErrors(body);
      const parsed = createInvoiceSchema.safeParse(body);

      assert.ok(
        Object.keys(fieldErrors).length > 0,
        'the shared rule set must reject ' + name
      );
      assert.equal(parsed.success, false, 'the API validator must reject ' + name);

      if (parsed.success) return;
      const fromSchema = createInvoiceFieldErrors(parsed.error);

      for (const [field, message] of Object.entries(fieldErrors)) {
        assert.ok(
          fromSchema[field],
          'the API must also flag ' + field + ' for ' + name
        );
        assert.equal(
          fromSchema[field],
          message,
          'both sides must say the same thing about ' + field + ' for ' + name
        );
      }
    });
  }

  it('accepts the payloads the rule set accepts', () => {
    const accepted = [
      payload(),
      payload({ amount: 0.0000001 }),
      payload({ amount: 999_999_999.99 }),
      payload({ assetCode: 'USDC', assetIssuer: ISSUER }),
      payload({ customerEmail: 'client@example.com', sellerEmail: 'me@example.com' }),
      payload({ description: 'x'.repeat(500), customerName: 'y'.repeat(255) }),
      payload({ network: 'TESTNET' }),
      payload({ expiresInDays: 1 }),
      payload({ expiresInDays: 30 }),
    ];

    for (const body of accepted) {
      assert.deepEqual(collectCreateInvoiceFieldErrors(body), {});
      assert.equal(createInvoiceSchema.safeParse(body).success, true, JSON.stringify(body));
    }
  });

  it('flags every broken field at once instead of stopping at the first', () => {
    const fieldErrors = collectCreateInvoiceFieldErrors(
      payload({ amount: 0, customerEmail: 'nope', expiresInDays: 99 })
    );

    assert.deepEqual(Object.keys(fieldErrors).sort(), [
      'amount',
      'customerEmail',
      'expiresInDays',
    ]);
  });

  it('keeps the object-level asset rule under the field it belongs to', () => {
    const parsed = createInvoiceSchema.safeParse(payload({ assetCode: 'USDC' }));
    assert.equal(parsed.success, false);
    if (parsed.success) return;

    assert.deepEqual(createInvoiceFieldErrors(parsed.error), {
      assetIssuer: CREATE_INVOICE_MESSAGES.assetIssuerRequired,
    });
  });

  it('reports a payload that is not an object at all', () => {
    assert.deepEqual(collectCreateInvoiceFieldErrors('nope'), {
      form: CREATE_INVOICE_MESSAGES.payload,
    });
    assert.equal(collectCreateInvoiceFieldErrors(null).form, CREATE_INVOICE_MESSAGES.payload);
  });
});

describe('create-invoice endpoint - the refusal names its fields', () => {
  const handlers = () => createInvoiceHandlers({ storage: new MemoryInvoiceStorage() });

  it('answers an invalid payload with 400, a stable code and field errors', async () => {
    const res = await call(
      handlers().createInvoice as any,
      createReq({ body: payload({ amount: 0, customerEmail: 'nope' }) })
    );

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'VALIDATION_ERROR');
    assert.equal(res.body.error, CREATE_INVOICE_MESSAGES.amountPositive);
    assert.deepEqual(Object.keys(res.body.fieldErrors).sort(), ['amount', 'customerEmail']);
    assert.equal(
      res.body.fieldErrors.customerEmail,
      CREATE_INVOICE_MESSAGES.customerEmail
    );
  });

  it('generates the invoice memo itself and ignores one sent by the client', async () => {
    const handlers = createInvoiceHandlers({ storage: new MemoryInvoiceStorage() });

    const withClientMemo = await call(
      handlers.createInvoice as any,
      createReq({ body: { ...payload(), memo: 'INV-CLIENT-SUPPLIED' } })
    );
    const plain = await call(
      handlers.createInvoice as any,
      createReq({ body: payload({ customerEmail: 'second@client.example' }) })
    );

    assert.equal(withClientMemo.statusCode, 201, JSON.stringify(withClientMemo.body));
    assert.equal(plain.statusCode, 201, JSON.stringify(plain.body));

    const memo = withClientMemo.body.data.invoice.memo;
    assert.equal(typeof memo, 'string');
    assert.notEqual(memo, 'INV-CLIENT-SUPPLIED', 'a client cannot choose the invoice memo');
    assert.equal(isValidMemo(memo), true, 'the generated memo follows the documented format');
    assert.notEqual(
      memo,
      plain.body.data.invoice.memo,
      'two invoices never share a memo'
    );
  });

  it('every generated memo satisfies the format the API advertises', () => {
    // The format is INV-TIMESTAMP-RANDOM over [A-Z0-9]. Drawing the random
    // tail from nanoid's default alphabet made this fail about one run in
    // five, because '-' and '_' are valid nanoid output and invalid memos.
    const memos = new Set<string>();
    for (let index = 0; index < 500; index += 1) {
      const memo = generateInvoiceMemo();
      assert.equal(isValidMemo(memo), true, `generated memo is unparseable: ${memo}`);
      assert.equal(hasInvoiceMemoPrefix(memo), true, `generated memo lost its prefix: ${memo}`);
      memos.add(memo);
    }
    assert.equal(memos.size, 500, 'generated memos are expected to be unique');
  });

  it('still creates an invoice for a valid payload', async () => {
    const res = await call(handlers().createInvoice as any, createReq({ body: payload() }));

    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.invoice.amount, 25);
    assert.equal(res.body.data.invoice.sellerPublicKey, SELLER);
  });
});
