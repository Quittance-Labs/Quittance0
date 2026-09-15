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
  isQuittanceProof,
  renderQuittanceProofHtml,
  createQuittanceProofPdf,
  QUITTANCE_PROOF_VERSION,
} = require('../lib/quittance-proof.ts');

const {
  generateInvoicePDF,
  generateQuittanceProofPDF,
} = require('../lib/export.ts');

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
