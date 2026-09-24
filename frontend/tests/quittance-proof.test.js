// The PDF creation date is rendered by jsPDF in the host's local time with
// its UTC offset, so the same proof produced on two machines differed in that
// one token and the golden comparison failed on every host outside the zone
// the fixture was made in. The zone is pinned before anything renders; the
// assertion below stays byte-for-byte.
process.env.TZ = 'UTC';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { jsPDF } = require('jspdf');

const {
  buildQuittanceProof,
  serializeQuittanceProof,
  parseQuittanceProof,
  checkQuittanceProofInvariants,
  validateQuittanceProofSchema,
  isQuittanceProof,
  renderQuittanceProofHtml,
  createQuittanceProofPdf,
  QUITTANCE_PROOF_VERSION,
  QUITTANCE_PROOF_FIELDS,
} = require('../lib/quittance-proof.ts');

const {
  generateInvoicePDF,
  generateQuittanceProofPDF,
} = require('../lib/export.ts');

const {
  buildProofMailto,
} = require('../lib/mailto-delivery.js');

const proofSchema = require('../lib/quittance-proof.schema.json');

const {
  NETWORK,
  TX_HASH,
  FIXED_NOW,
  paidInvoice,
  pendingInvoice,
  goldenProofJson,
  goldenProofHtml,
  goldenProofPdfBuffer,
} = require('./fixtures/quittance-proof.fixture');

function build(input, options = {}) {
  const result = buildQuittanceProof(input, {
    network: NETWORK,
    now: FIXED_NOW,
    ...options,
  });
  assert.equal(result.ok, true, 'expected a proof but got ' + JSON.stringify(result));
  return result.proof;
}

test('produces the golden document for the fixture invoice', () => {
  const proof = build(paidInvoice);
  assert.equal(serializeQuittanceProof(proof), goldenProofJson);
});

test('is deterministic for the same input and clock', () => {
  const first = serializeQuittanceProof(build(paidInvoice));
  const second = serializeQuittanceProof(build(paidInvoice));
  assert.equal(first, second);
});

test('serialized key order follows the schema, not the input order', () => {
  const shuffled = {
    paidAt: paidInvoice.paidAt,
    assetIssuer: paidInvoice.assetIssuer,
    memo: paidInvoice.memo,
    paymentTxHash: paidInvoice.paymentTxHash,
    amount: paidInvoice.amount,
    payerPublicKey: paidInvoice.payerPublicKey,
    id: paidInvoice.id,
    expiresAt: paidInvoice.expiresAt,
    assetCode: paidInvoice.assetCode,
    status: paidInvoice.status,
    createdAt: paidInvoice.createdAt,
    sellerPublicKey: paidInvoice.sellerPublicKey,
  };
  assert.equal(serializeQuittanceProof(build(shuffled)), goldenProofJson);
});

test('satisfies every declared invariant', () => {
  assert.deepEqual(checkQuittanceProofInvariants(goldenProofJson), []);
});

test('normalizes amounts to seven decimals without floats', () => {
  assert.equal(build(paidInvoice).payment.amount, '250.5000000');
  assert.equal(build({ ...paidInvoice, amount: '12' }).payment.amount, '12');
  assert.equal(build({ ...paidInvoice, amount: 12.5 }).payment.amount, '12.5000000');
});

test('records the explorer link for the invoice network', () => {
  const testnet = build(paidInvoice);
  assert.equal(testnet.payment.explorerUrl, 'https://stellar.expert/explorer/testnet/tx/' + TX_HASH);

  const mainnet = build(paidInvoice, { network: 'public' });
  assert.equal(mainnet.network, 'public');
  assert.equal(mainnet.payment.explorerUrl, 'https://stellar.expert/explorer/public/tx/' + TX_HASH);
});

test('keeps an unsettled invoice honest instead of rendering blank fields', () => {
  const proof = build(pendingInvoice);
  assert.equal(proof.status, 'PENDING');
  assert.equal(proof.settledAt, null);
  assert.equal(proof.payment.txHash, '');
  assert.equal(proof.payment.explorerUrl, null);
  assert.deepEqual(proof.verification, {
    status: 'unverified',
    method: 'none',
    checkedAt: null,
    settlementContext: null,
    latePaymentWarningCode: null,
  });
  assert.equal(proof.schemaVersion, QUITTANCE_PROOF_VERSION);
});

test('never infers a payer that the invoice did not record', () => {
  const proof = build({ ...pendingInvoice });
  assert.equal(proof.payer, null);
});

test('round trips through the machine-readable export', () => {
  const proof = build(paidInvoice);
  const parsed = parseQuittanceProof(serializeQuittanceProof(proof));
  assert.deepEqual(parsed, proof);
  assert.equal(parseQuittanceProof('{"schemaVersion":"quittance.v2"}'), null);
  assert.equal(parseQuittanceProof('not json'), null);
});

test('refuses to build a proof it cannot stand behind', () => {
  const cases = [
    [{ ...paidInvoice, id: '' }, 'MISSING_INVOICE_ID'],
    [{ ...paidInvoice, sellerPublicKey: '' }, 'MISSING_SELLER'],
    [{ ...paidInvoice, amount: '12.12345678' }, 'INVALID_AMOUNT'],
    [{ ...paidInvoice, amount: 'not a number' }, 'INVALID_AMOUNT'],
    [{ ...paidInvoice, paymentTxHash: null }, 'INVALID_TX_HASH'],
    [{ ...paidInvoice, paymentTxHash: 'abc' }, 'INVALID_TX_HASH'],
  ];
  for (const [input, code] of cases) {
    const result = buildQuittanceProof(input, { network: NETWORK, now: FIXED_NOW });
    assert.equal(result.ok, false, 'expected failure for ' + code);
    assert.equal(result.code, code);
    assert.ok(result.message.length > 0);
  }
});

test('detects invariant violations in a hand-edited document', () => {
  const withSecret = goldenProofJson.replace(
    '"payer": "' + build(paidInvoice).payer + '"',
    '"payer": "S' + 'A'.repeat(55) + '"'
  );
  assert.deepEqual(checkQuittanceProofInvariants(withSecret), ['NO_SECRET_KEY']);

  const withEmail = goldenProofJson.replace(
    '"memo": "QUIT-8QM2"',
    '"memo": "payer@example.com"'
  );
  assert.deepEqual(checkQuittanceProofInvariants(withEmail), ['NO_PAYER_PII']);

  const numericAmount = goldenProofJson.replace('"amount": "250.5000000"', '"amount": 250.5');
  assert.deepEqual(checkQuittanceProofInvariants(numericAmount), ['AMOUNTS_ARE_STRINGS']);

  const payerList = goldenProofJson.replace(
    '"payer": "' + build(paidInvoice).payer + '"',
    '"payer": ["G1", "G2"]'
  );
  assert.deepEqual(checkQuittanceProofInvariants(payerList), ['SINGLE_COUNTERPARTY']);

  const staleVersion = goldenProofJson.replace('"quittance.v1"', '"quittance.v0"');
  assert.deepEqual(checkQuittanceProofInvariants(staleVersion), ['VERSIONED']);

  const localTime = goldenProofJson.replace(
    '"settledAt": "2026-09-13T09:21:44.000Z"',
    '"settledAt": "2026-09-13 09:21:44"'
  );
  assert.deepEqual(checkQuittanceProofInvariants(localTime), ['UTC_TIMESTAMPS']);

  assert.deepEqual(checkQuittanceProofInvariants('{'), ['NOT_JSON']);
});

test('renders the golden HTML document for the fixture proof', () => {
  const proof = build(paidInvoice);
  const renderedHtml = renderQuittanceProofHtml(proof);
  assert.equal(renderedHtml, goldenProofHtml);
});

test('produces byte-for-byte deterministic PDF matching the golden PDF fixture', () => {
  const proof = build(paidInvoice);
  const doc = createQuittanceProofPdf(proof, jsPDF);
  const generatedBuffer = Buffer.from(doc.output('arraybuffer'));
  assert.equal(generatedBuffer.equals(goldenProofPdfBuffer), true);
});

test('verifies HTML rendering enforces anti-leak and invariant constraints', () => {
  const proof = build(paidInvoice);
  const html = renderQuittanceProofHtml(proof);

  assert.equal(/S[A-Z2-7]{55}/.test(html), false);
  assert.equal(/[^\s@]+@[^\s@]+\.[^\s@]+/.test(html), false);
  assert.ok(html.includes('quittance.v1'));
  assert.ok(html.includes('250.5000000 USDC'));
  assert.ok(html.includes('2026-09-13T09:21:44.000Z'));
  assert.ok(html.includes('2026-09-13T12:00:00.000Z'));
  assert.ok(html.includes('inv_8Qm2'));
});

test('type guard correctly identifies quittance proofs vs raw invoice objects', () => {
  const proof = build(paidInvoice);
  assert.equal(isQuittanceProof(proof), true);
  assert.equal(isQuittanceProof(paidInvoice), false);
  assert.equal(isQuittanceProof(null), false);
  assert.equal(isQuittanceProof({}), false);
  assert.equal(isQuittanceProof({ schemaVersion: 'quittance.v0' }), false);
});

test('generateInvoicePDF delegates directly to renderQuittanceProofHtml for QuittanceProof', () => {
  const proof = build(paidInvoice);
  const fromExport = generateInvoicePDF(proof);
  const fromProof = renderQuittanceProofHtml(proof);
  const fromQuittancePdf = generateQuittanceProofPDF(proof);

  assert.equal(fromExport, fromProof);
  assert.equal(fromQuittancePdf, fromProof);
  assert.equal(fromExport, goldenProofHtml);
});

// --- Issue #509: deterministic paid-invoice export -------------------------

const paidXlmInvoice = {
  id: 'inv_Xlm1',
  status: 'PAID',
  sellerPublicKey: 'G' + 'B'.repeat(55),
  payerPublicKey: 'G' + 'C'.repeat(55),
  amount: 42.5,
  assetCode: 'XLM',
  memo: 'QUIT-XLM1',
  paymentTxHash: TX_HASH,
  createdAt: '2026-09-10T09:00:00.000Z',
  expiresAt: '2026-09-17T09:00:00.000Z',
  paidAt: '2026-09-13T09:21:44.000Z',
  settledAt: '2026-09-13T09:21:44.000Z',
};

test('paid invoice export is byte-identical in UTC and a non-UTC timezone', () => {
  process.env.TZ = 'UTC';
  const usdcUtc = generateInvoicePDF(paidInvoice);
  const xlmUtc = generateInvoicePDF(paidXlmInvoice);

  process.env.TZ = 'America/New_York';
  const usdcNy = generateInvoicePDF(paidInvoice);
  const xlmNy = generateInvoicePDF(paidXlmInvoice);
  process.env.TZ = 'UTC';

  assert.equal(usdcUtc, usdcNy, 'USDC invoice export drifted between timezones');
  assert.equal(xlmUtc, xlmNy, 'XLM invoice export drifted between timezones');
});

test('paid invoice export carries hash, explorer URL, and canonical amount', () => {
  const html = generateInvoicePDF(paidInvoice);
  assert.ok(html.includes(TX_HASH), 'transaction hash must appear in the export');
  assert.ok(html.includes('stellar.expert/explorer/testnet'), 'explorer URL must name the network');
  assert.ok(html.includes('250.5000000'), 'amount must print as the canonical stroop string');

  const xlmHtml = generateInvoicePDF(paidXlmInvoice);
  assert.ok(xlmHtml.includes('42.5000000'), 'numeric amount must canonicalize');
  assert.ok(xlmHtml.includes('Payment settled: Sep 13, 2026, 09:21 UTC'));
  assert.ok(!/Generated on/.test(xlmHtml), 'no wall-clock token may appear in the export');
});

test('unpaid invoices still refuse export through generateInvoicePDF', () => {
  assert.throws(() => generateInvoicePDF(pendingInvoice), /paid/i);
});

const GOLDEN_INVOICE_USDC = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'golden-invoice-usdc.html'),
  'utf8'
);
const GOLDEN_INVOICE_XLM = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'golden-invoice-xlm.html'),
  'utf8'
);

test('paid invoice exports match the golden fixtures byte for byte', () => {
  assert.equal(generateInvoicePDF(paidInvoice), GOLDEN_INVOICE_USDC);
  assert.equal(generateInvoicePDF(paidXlmInvoice), GOLDEN_INVOICE_XLM);
});


test('paid and unpaid fixtures remain schema-valid', () => {
  const paid = build(paidInvoice);
  const paidValidation = validateQuittanceProofSchema(paid);
  assert.equal(paidValidation.valid, true, JSON.stringify(paidValidation.errors));

  const pending = build(pendingInvoice);
  const pendingValidation = validateQuittanceProofSchema(pending);
  assert.equal(pendingValidation.valid, true, JSON.stringify(pendingValidation.errors));
});

test('golden schema deletion: removing any required schema field fails validation and invariant check', () => {
  const fixtures = [build(paidInvoice), build(pendingInvoice)];
  assert.ok(Array.isArray(proofSchema.required) && proofSchema.required.length > 0);
  assert.deepEqual(proofSchema.required, [...QUITTANCE_PROOF_FIELDS]);

  for (const doc of fixtures) {
    for (const requiredKey of proofSchema.required) {
      const clone = JSON.parse(JSON.stringify(doc));
      delete clone[requiredKey];

      const validation = validateQuittanceProofSchema(clone);
      assert.equal(validation.valid, false, `Expected validation failure when omitting ${requiredKey}`);
      assert.ok(
        validation.errors.some((err) => err.includes(requiredKey)),
        `Expected error message to mention ${requiredKey}`
      );

      assert.equal(parseQuittanceProof(JSON.stringify(clone)), null);

      const invariants = checkQuittanceProofInvariants(JSON.stringify(clone));
      assert.ok(
        invariants.includes(`REQUIRED_FIELD_${requiredKey}`),
        `Expected invariant check to report REQUIRED_FIELD_${requiredKey}, got ${JSON.stringify(invariants)}`
      );
    }
  }
});

test('explorer links match the configured network (testnet vs public)', () => {
  const testnetProof = build(paidInvoice, { network: 'testnet' });
  assert.equal(testnetProof.network, 'testnet');
  assert.ok(testnetProof.payment.explorerUrl.includes('testnet'));
  assert.equal(testnetProof.payment.explorerUrl.includes('/public/'), false);

  const publicProof = build(paidInvoice, { network: 'public' });
  assert.equal(publicProof.network, 'public');
  assert.ok(publicProof.payment.explorerUrl.includes('public'));
  assert.equal(publicProof.payment.explorerUrl.includes('testnet'), false);
});

test('optional email still does not gate create, pay, or proof generation', () => {
  const noEmailInvoice = {
    ...paidInvoice,
    customerEmail: undefined,
    payerEmail: undefined,
  };
  const proof = build(noEmailInvoice);
  assert.ok(proof);
  assert.equal(isQuittanceProof(proof), true);
  assert.equal(validateQuittanceProofSchema(proof).valid, true);

  const html = renderQuittanceProofHtml(proof);
  assert.ok(html.length > 0);

  const doc = createQuittanceProofPdf(proof, jsPDF);
  assert.ok(doc);
});

test('receipt, PDF, and mailto share the same document builder', () => {
  const proof = build(paidInvoice);
  const mailto = buildProofMailto(proof, 'https://quittance.example.com', 'client@example.com');

  assert.ok(mailto.startsWith('mailto:client%40example.com?'));
  assert.ok(mailto.includes(encodeURIComponent(proof.invoiceId)));
  assert.ok(mailto.includes(encodeURIComponent(proof.payment.amount)));
  assert.ok(mailto.includes(encodeURIComponent(proof.payment.asset.code)));
  assert.ok(mailto.includes(encodeURIComponent(proof.payment.txHash)));
  assert.ok(mailto.includes(encodeURIComponent(proof.payment.explorerUrl)));
  assert.ok(mailto.includes(encodeURIComponent(proof.seller)));

  const html = renderQuittanceProofHtml(proof);
  assert.ok(html.includes(proof.invoiceId));
  assert.ok(html.includes(proof.payment.amount));
  assert.ok(html.includes(proof.payment.txHash));
  assert.ok(html.includes(proof.payment.explorerUrl));
  assert.ok(html.includes(proof.seller));
});
