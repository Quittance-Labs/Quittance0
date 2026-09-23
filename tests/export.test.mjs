import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createRequire } from 'node:module';
import test from 'node:test';

register('./export-loader.mjs', import.meta.url);

// The same golden fixtures the quittance-proof suite pins byte-for-byte, so
// the field checks below cannot drift from the proof schema (issue #434).
const require = createRequire(import.meta.url);
const {
  NETWORK: PROOF_NETWORK,
  TX_HASH: PROOF_TX_HASH,
  FIXED_NOW: PROOF_FIXED_NOW,
  paidInvoice: proofPaidInvoice,
  pendingInvoice: proofPendingInvoice,
} = require('../frontend/tests/fixtures/quittance-proof.fixture.js');

const {
  escapeHtml,
  generateInvoicePDF,
  generateQuittanceProofPDF,
  buildQuittanceProof,
  isQuittanceProof,
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

// ---------------------------------------------------------------------------
// Print/PDF proof output: required fields, paid and unpaid (issue #434)
//
// Proof is the deliverable, and the export paths are the last place a field
// can go missing without anyone noticing. These cases drive the shipped
// renderers and report which field disappeared by name, so a dropped field
// fails here rather than in a reviewer's PDF.
// ---------------------------------------------------------------------------

const PAID_INVOICE = {
  id: 'inv_export_paid',
  amount: 250.5,
  assetCode: 'USDC',
  assetIssuer: 'G' + 'D'.repeat(55),
  description: 'Exported proof fixture',
  customerName: 'Ada Client',
  customerEmail: 'ada@example.com',
  sellerName: 'Quittance Labs',
  sellerEmail: 'billing@example.com',
  payerName: 'Ada Payer',
  payerEmail: 'ada@example.com',
  status: 'PAID',
  createdAt: '2026-09-10T09:00:00.000Z',
  expiresAt: '2026-09-17T09:00:00.000Z',
  paidAt: '2026-09-13T09:21:44.000Z',
  memo: 'QUIT-EXPORT-1',
  sellerPublicKey: 'G' + 'B'.repeat(55),
  payerPublicKey: 'G' + 'C'.repeat(55),
  paymentTxHash: 'd'.repeat(64),
};

/** Runs a `{ field: expected text }` manifest and names what is missing. */
function assertFieldsPresent(html, required, label) {
  for (const [field, expected] of Object.entries(required)) {
    assert.ok(
      html.includes(expected),
      `${label} dropped the ${field} (looked for ${JSON.stringify(expected)})`
    );
  }
}

/** The set the issue names: amount, asset, memo, parties, tx hash, explorer. */
const REQUIRED_PAID_FIELDS = (invoice, explorerUrl) => ({
  'invoice id': invoice.id,
  amount: String(invoice.amount),
  asset: invoice.assetCode,
  memo: invoice.memo,
  seller: invoice.sellerPublicKey,
  payer: invoice.payerPublicKey,
  'transaction hash': invoice.paymentTxHash,
  'explorer link': explorerUrl,
});

function withNetwork(value, run) {
  const previous = process.env.NEXT_PUBLIC_STELLAR_NETWORK;
  process.env.NEXT_PUBLIC_STELLAR_NETWORK = value;
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    } else {
      process.env.NEXT_PUBLIC_STELLAR_NETWORK = previous;
    }
  }
}

test('the paid invoice print/PDF export keeps every required field, explorer link included', () => {
  const html = withNetwork('TESTNET', () => generateInvoicePDF(PAID_INVOICE));

  assertFieldsPresent(
    html,
    REQUIRED_PAID_FIELDS(
      PAID_INVOICE,
      'https://stellar.expert/explorer/testnet/tx/' + PAID_INVOICE.paymentTxHash
    ),
    'the invoice export'
  );
  // The link is clickable, not just printed as text.
  assert.ok(
    html.includes(`<a href="https://stellar.expert/explorer/testnet/tx/${PAID_INVOICE.paymentTxHash}">`),
    'the explorer URL is not an anchor'
  );
});

test('the export follows the configured network instead of assuming mainnet', () => {
  const mainnet = withNetwork('PUBLIC', () => generateInvoicePDF(PAID_INVOICE));
  assert.ok(mainnet.includes('https://stellar.expert/explorer/public/tx/' + PAID_INVOICE.paymentTxHash));
  assert.ok(!mainnet.includes('https://stellar.expert/explorer/testnet/tx/'));

  const testnet = withNetwork('TESTNET', () => generateInvoicePDF(PAID_INVOICE));
  assert.ok(testnet.includes('https://stellar.expert/explorer/testnet/tx/' + PAID_INVOICE.paymentTxHash));
  assert.ok(!testnet.includes('https://stellar.expert/explorer/public/tx/'));
});

test('an unpaid invoice has no proof export, as documented', () => {
  assert.throws(
    () => generateInvoicePDF({ ...PAID_INVOICE, status: 'PENDING', paymentTxHash: undefined }),
    /Payment proof is available only after the invoice is paid/
  );
  assert.throws(
    () => generateInvoicePDF({ ...PAID_INVOICE, status: 'EXPIRED', paymentTxHash: undefined }),
    /this invoice expired unpaid/
  );
});

test('the canonical proof export keeps the same required fields for the golden paid fixture', () => {
  const result = buildQuittanceProof(proofPaidInvoice, {
    network: PROOF_NETWORK,
    now: PROOF_FIXED_NOW,
  });
  assert.equal(result.ok, true, JSON.stringify(result));

  const html = generateQuittanceProofPDF(result.proof);

  assertFieldsPresent(
    html,
    REQUIRED_PAID_FIELDS(
      { ...proofPaidInvoice, amount: '250.5000000' },
      'https://stellar.expert/explorer/testnet/tx/' + PROOF_TX_HASH
    ),
    'the canonical proof export'
  );
});

test('the canonical proof of an unpaid invoice prints no hash and no explorer link', () => {
  const result = buildQuittanceProof(proofPendingInvoice, {
    network: PROOF_NETWORK,
    now: PROOF_FIXED_NOW,
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.proof.payment.explorerUrl, null);

  const html = generateQuittanceProofPDF(result.proof);

  assert.ok(!html.includes('stellar.expert'), 'an unpaid proof linked to an explorer');
  assert.ok(!html.includes(PROOF_TX_HASH), 'an unpaid proof printed a transaction hash');
  assert.ok(html.includes('PENDING'));
  // The amount and the parties still have to be there: "unpaid" is not
  // "blank".
  assert.ok(html.includes(proofPendingInvoice.amount));
  assert.ok(html.includes(proofPendingInvoice.sellerPublicKey));
});

test('generateInvoicePDF and generateQuittanceProofPDF handle canonical QuittanceProof models', () => {
  const proofResult = buildQuittanceProof({
    id: 'test-canonical-1',
    status: 'PAID',
    sellerPublicKey: 'G' + 'B'.repeat(55),
    payerPublicKey: 'G' + 'C'.repeat(55),
    amount: '150.25',
    assetCode: 'USDC',
    assetIssuer: 'G' + 'D'.repeat(55),
    memo: 'MEMO-CANONICAL',
    paymentTxHash: 'c'.repeat(64),
    createdAt: '2026-08-01T10:00:00.000Z',
    expiresAt: '2026-08-08T10:00:00.000Z',
    paidAt: '2026-08-01T11:00:00.000Z',
  }, { network: 'testnet', now: new Date('2026-08-01T12:00:00.000Z') });

  assert.equal(proofResult.ok, true);
  assert.equal(isQuittanceProof(proofResult.proof), true);

  const htmlFromInvoicePdf = generateInvoicePDF(proofResult.proof);
  const htmlFromProofPdf = generateQuittanceProofPDF(proofResult.proof);

  assert.equal(htmlFromInvoicePdf, htmlFromProofPdf);
  assert.ok(htmlFromInvoicePdf.includes('quittance.v1'));
  assert.ok(htmlFromInvoicePdf.includes('150.2500000 USDC'));
  assert.ok(htmlFromInvoicePdf.includes('test-canonical-1'));
  assert.ok(!htmlFromInvoicePdf.includes('undefined'));
});

test('the paid invoice print/PDF export produces identical output across timezones', () => {
  const previousTz = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    const utcHtml = withNetwork('TESTNET', () => generateInvoicePDF(PAID_INVOICE));
    process.env.TZ = 'America/New_York';
    const nyHtml = withNetwork('TESTNET', () => generateInvoicePDF(PAID_INVOICE));
    assert.equal(utcHtml, nyHtml);
  } finally {
    if (previousTz === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTz;
    }
  }
});

test('amounts on the export match string-safe 7-decimal format', () => {
  const html = withNetwork('TESTNET', () => generateInvoicePDF(PAID_INVOICE));
  assert.ok(html.includes('250.5000000'));
});

test('dropping transaction hash or explorer link fails the required fields check', () => {
  const html = withNetwork('TESTNET', () => generateInvoicePDF(PAID_INVOICE));
  const missingTxHashFields = {
    ...REQUIRED_PAID_FIELDS(PAID_INVOICE, 'https://stellar.expert/explorer/testnet/tx/' + PAID_INVOICE.paymentTxHash),
    'transaction hash': '0'.repeat(64),
  };
  assert.throws(
    () => assertFieldsPresent(html, missingTxHashFields, 'the invoice export'),
    /dropped the transaction hash/
  );

  const missingExplorerFields = {
    ...REQUIRED_PAID_FIELDS(PAID_INVOICE, 'https://stellar.expert/explorer/testnet/tx/' + PAID_INVOICE.paymentTxHash),
    'explorer link': 'https://stellar.expert/explorer/testnet/tx/' + '0'.repeat(64),
  };
  assert.throws(
    () => assertFieldsPresent(html, missingExplorerFields, 'the invoice export'),
    /dropped the explorer link/
  );
});

test('optional email does not gate PDF export', () => {
  const invoiceWithoutEmails = {
    ...PAID_INVOICE,
    customerEmail: '',
    sellerEmail: '',
    payerEmail: '',
  };
  const html = withNetwork('TESTNET', () => generateInvoicePDF(invoiceWithoutEmails));
  assert.ok(html.includes(invoiceWithoutEmails.id));
  assert.ok(html.includes(invoiceWithoutEmails.paymentTxHash));
  assert.ok(html.includes('250.5000000'));
});


