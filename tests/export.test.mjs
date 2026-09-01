import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register('./export-loader.mjs', import.meta.url);

const {
  escapeHtml,
  generateInvoicePDF,
  buildInvoiceMailto,
  buildProofMailto,
  canSendInvoiceEmail,
  canSendProofEmail,
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

test('buildInvoiceMailto and buildProofMailto generate valid mailto links with encoded metadata', () => {
  const invoice = {
    id: 'test-invoice-123',
    amount: 100,
    assetCode: 'USDC',
    status: 'PAID',
    customerName: 'Alice Client',
    customerEmail: 'alice@client.example',
    sellerName: 'Bob Studio',
    sellerEmail: 'bob@studio.example',
    payerName: 'Alice Payer',
    payerEmail: 'alice@client.example',
    memo: 'INV-TEST123',
    description: 'Design Deliverables',
    paidAt: '2026-08-01T12:00:00.000Z',
    paymentTxHash: 'b'.repeat(64),
    sellerPublicKey: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
    payerPublicKey: 'GCL6OXAMLD75BMTINA6EMRUDWK5THQUSHMYNLSNBCJAPZJHNYJTUNIBC',
  };

  assert.equal(canSendInvoiceEmail(invoice), true);
  assert.equal(canSendProofEmail(invoice), true);

  const invoiceMailto = buildInvoiceMailto(invoice, 'https://quittance.example');
  assert.ok(invoiceMailto.startsWith('mailto:alice%40client.example?'));
  assert.ok(invoiceMailto.includes('subject=Invoice%20%23TEST-INV%20-%20100%20USDC'));
  assert.ok(invoiceMailto.includes(encodeURIComponent('Payment Link: https://quittance.example/pay/test-invoice-123')));

  const proofMailto = buildProofMailto(invoice, 'https://quittance.example');
  assert.ok(proofMailto.startsWith('mailto:alice%40client.example?'));
  assert.ok(proofMailto.includes('subject=Payment%20Proof%20-%20Invoice%20%23TEST-INV%20-%20100%20USDC'));
  assert.ok(proofMailto.includes(encodeURIComponent(`Transaction Hash: ${'b'.repeat(64)}`)));
});

