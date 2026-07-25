import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'date-fns') {
      return {
        shortCircuit: true,
        url: 'data:text/javascript,export function format() { return "formatted date"; }',
      };
    }

    return nextResolve(specifier, context);
  },
});

const {
  escapeHtml,
  generateInvoicePDF,
  generatePDFContent,
} = await import('../frontend/lib/export.ts');

test('escapeHtml encodes characters that can create HTML markup or attributes', () => {
  assert.equal(
    escapeHtml(`<script data-value="'">& run()</script>`),
    '&lt;script data-value=&quot;&#039;&quot;&gt;&amp; run()&lt;/script&gt;'
  );
});

test('generateInvoicePDF renders user-supplied proof fields as literal text', () => {
  const invoice = {
    id: 'invoice-<id>',
    amount: 25,
    assetCode: 'XLM<asset>',
    description: 'Description <script>globalThis.compromised = true</script> and <b>bold</b>',
    customerName: 'Customer <customer-name>',
    customerEmail: 'customer+<customer-email>@example.com',
    sellerName: 'Seller <seller-name>',
    sellerEmail: 'seller+<seller-email>@example.com',
    payerName: 'Payer <payer-name>',
    payerEmail: 'payer+<payer-email>@example.com',
    status: 'PAID',
    createdAt: '2026-07-25T10:00:00.000Z',
    expiresAt: '2026-08-25T10:00:00.000Z',
    paidAt: '2026-07-25T11:00:00.000Z',
    memo: 'Memo <memo>',
    sellerPublicKey: 'GSELLER<seller-key>',
    payerPublicKey: 'GPAYER<payer-key>',
    paymentTxHash: 'hash<transaction-hash>',
  };

  const html = generateInvoicePDF(invoice);

  for (const value of [
    invoice.id,
    invoice.assetCode,
    invoice.description,
    invoice.customerName,
    invoice.customerEmail,
    invoice.sellerName,
    invoice.sellerEmail,
    invoice.payerName,
    invoice.payerEmail,
    invoice.memo,
    invoice.sellerPublicKey,
    invoice.payerPublicKey,
    invoice.paymentTxHash,
  ]) {
    assert.ok(html.includes(escapeHtml(value)));
    assert.ok(!html.includes(value));
  }

  assert.ok(html.includes('&lt;script&gt;globalThis.compromised = true&lt;/script&gt;'));
  assert.ok(html.includes('&lt;b&gt;bold&lt;/b&gt;'));
  assert.ok(!html.includes('<script>'));
});

test('generatePDFContent escapes transaction report fields before document.write', () => {
  const transaction = {
    id: 'transaction-id',
    hash: 'hash<hash-field>remaining',
    type: 'received',
    from: 'GFROM<from-field>',
    to: 'GTO<to-field>',
    amount: '10',
    assetCode: 'XLM<asset-code>',
    memo: 'Memo <script>run()</script>',
    createdAt: '2026-07-25T10:00:00.000Z',
    ledger: 123,
  };
  const publicKey = 'GACCOUNT<account-field>';

  const html = generatePDFContent([transaction], publicKey);

  for (const value of [publicKey, transaction.from, transaction.assetCode, transaction.memo]) {
    assert.ok(html.includes(escapeHtml(value)));
    assert.ok(!html.includes(value));
  }

  const renderedHash = transaction.hash.substring(0, 16);
  assert.ok(html.includes(escapeHtml(renderedHash)));
  assert.ok(!html.includes(renderedHash));
  assert.ok(!html.includes('<script>'));
});
