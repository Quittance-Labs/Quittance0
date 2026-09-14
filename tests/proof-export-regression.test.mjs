import assert from 'node:assert/strict';
import { register } from 'node:module';
import test, { describe, it } from 'node:test';

register('./export-loader.mjs', import.meta.url);

const { jsPDF } = await import('jspdf');

const {
  buildQuittanceProof,
  createQuittanceProofPdf,
  renderQuittanceProofHtml,
  QUITTANCE_PROOF_VERSION,
} = await import('../frontend/lib/quittance-proof.ts');

const {
  generateInvoicePDF,
  generateQuittanceProofPDF,
  assertPaymentProofAvailable,
  canExportPaymentProof,
} = await import('../frontend/lib/export.ts');

const {
  NETWORK,
  TX_HASH,
  FIXED_NOW,
  paidInvoice,
  pendingInvoice,
  goldenProofHtml,
} = await import('../frontend/tests/fixtures/quittance-proof.fixture.js');

/**
 * Validates that an export output (HTML string or extracted PDF text)
 * contains all required canonical proof fields for a paid invoice.
 *
 * @param {string} output - Rendered HTML or PDF stream text.
 * @param {object} expected - Expected field values.
 * @returns {string[]} List of missing field names.
 */
function checkRequiredPaidProofFields(output, expected) {
  const missing = [];
  if (!output.includes(expected.amount)) missing.push('amount');
  if (!output.includes(expected.assetCode)) missing.push('assetCode');
  if (!output.includes(expected.memo)) missing.push('memo');
  if (!output.includes(expected.seller)) missing.push('seller');
  if (!output.includes(expected.payer)) missing.push('payer');
  if (!output.includes(expected.txHash)) missing.push('txHash');
  if (!output.includes(expected.explorerUrl)) missing.push('explorerUrl');
  if (!output.includes(expected.status)) missing.push('status');
  return missing;
}

function assertRequiredPaidProofFields(output, expected, context = 'export') {
  const missing = checkRequiredPaidProofFields(output, expected);
  assert.equal(
    missing.length,
    0,
    `Required proof fields dropped from ${context} output: ${missing.join(', ')}`
  );
}

describe('Proof Export Regression Test Suite (#434)', () => {
  const expectedPaid = {
    amount: '250.5000000',
    rawAmount: '250.5',
    assetCode: 'USDC',
    assetIssuer: paidInvoice.assetIssuer,
    memo: 'QUIT-8QM2',
    seller: paidInvoice.sellerPublicKey,
    payer: paidInvoice.payerPublicKey,
    txHash: TX_HASH,
    explorerUrl: `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`,
    publicExplorerUrl: `https://stellar.expert/explorer/public/tx/${TX_HASH}`,
    status: 'PAID',
    schemaVersion: QUITTANCE_PROOF_VERSION,
  };

  describe('1. Paid QuittanceProof HTML Export', () => {
    it('renders all required canonical fields in renderQuittanceProofHtml', () => {
      const proofResult = buildQuittanceProof(paidInvoice, { network: NETWORK, now: FIXED_NOW });
      assert.equal(proofResult.ok, true);
      const html = renderQuittanceProofHtml(proofResult.proof);

      assertRequiredPaidProofFields(html, expectedPaid, 'renderQuittanceProofHtml');
      assert.ok(html.includes(expectedPaid.assetIssuer), 'Must include asset issuer for credit assets');
      assert.ok(html.includes(expectedPaid.schemaVersion), 'Must include schema version');
      assert.ok(html.includes(proofResult.proof.invoiceId), 'Must include invoiceId');
      assert.ok(html.includes(proofResult.proof.issuedAt), 'Must include issuedAt timestamp');
      assert.ok(html.includes(proofResult.proof.dueAt), 'Must include dueAt timestamp');
      assert.ok(html.includes(proofResult.proof.settledAt), 'Must include settledAt timestamp');
      assert.equal(html, goldenProofHtml, 'Matches golden HTML fixture');
    });

    it('generateQuittanceProofPDF delegates directly to renderQuittanceProofHtml', () => {
      const proof = buildQuittanceProof(paidInvoice, { network: NETWORK, now: FIXED_NOW }).proof;
      const html = generateQuittanceProofPDF(proof);
      assertRequiredPaidProofFields(html, expectedPaid, 'generateQuittanceProofPDF');
      assert.equal(html, renderQuittanceProofHtml(proof));
    });
  });

  describe('2. Paid Raw Invoice HTML Export (generateInvoicePDF)', () => {
    it('renders all required fields including txHash and explorerUrl', () => {
      const html = generateInvoicePDF(paidInvoice);

      assertRequiredPaidProofFields(
        html,
        { ...expectedPaid, amount: expectedPaid.rawAmount },
        'generateInvoicePDF'
      );
      assert.ok(html.includes('Explorer Record'), 'Must render Explorer Record row');
      assert.ok(html.includes(expectedPaid.explorerUrl), 'Must include clickable explorer URL');
      assert.ok(html.includes(expectedPaid.txHash), 'Must include transaction hash');
      assert.ok(html.includes(expectedPaid.seller), 'Must include seller address');
      assert.ok(html.includes(expectedPaid.payer), 'Must include payer address');
    });
  });

  describe('3. Paid jsPDF Document Export (createQuittanceProofPdf)', () => {
    it('encodes all required fields in the PDF document stream', () => {
      const proof = buildQuittanceProof(paidInvoice, { network: NETWORK, now: FIXED_NOW }).proof;
      const doc = createQuittanceProofPdf(proof, jsPDF);
      const pdfText = Buffer.from(doc.output('arraybuffer')).toString('latin1');

      assertRequiredPaidProofFields(pdfText, expectedPaid, 'createQuittanceProofPdf');
      assert.ok(pdfText.includes(`Amount: ${expectedPaid.amount} ${expectedPaid.assetCode}`));
      assert.ok(pdfText.includes(`Seller: ${expectedPaid.seller}`));
      assert.ok(pdfText.includes(`Payer: ${expectedPaid.payer}`));
      assert.ok(pdfText.includes(`Memo: ${expectedPaid.memo}`));
      assert.ok(pdfText.includes(`Transaction Hash: ${expectedPaid.txHash}`));
      assert.ok(pdfText.includes(`Explorer: ${expectedPaid.explorerUrl}`));
    });
  });

  describe('4. Network-Aware Explorer URLs', () => {
    it('constructs public explorer links when network is public', () => {
      const proof = buildQuittanceProof(paidInvoice, { network: 'public', now: FIXED_NOW }).proof;
      assert.equal(proof.network, 'public');
      assert.equal(proof.payment.explorerUrl, expectedPaid.publicExplorerUrl);

      const html = renderQuittanceProofHtml(proof);
      assert.ok(html.includes(expectedPaid.publicExplorerUrl));
      assert.ok(!html.includes('explorer/testnet/tx'));

      const doc = createQuittanceProofPdf(proof, jsPDF);
      const pdfText = Buffer.from(doc.output('arraybuffer')).toString('latin1');
      assert.ok(pdfText.includes(expectedPaid.publicExplorerUrl));
    });
  });

  describe('5. Unpaid / Pending Invoice and Proof Invariants', () => {
    it('unpaid QuittanceProof cleanly omits settlement fields and explorer link', () => {
      const proof = buildQuittanceProof(pendingInvoice, { network: NETWORK, now: FIXED_NOW }).proof;
      assert.equal(proof.status, 'PENDING');
      assert.equal(proof.settledAt, null);
      assert.equal(proof.payment.txHash, '');
      assert.equal(proof.payment.explorerUrl, null);

      const html = renderQuittanceProofHtml(proof);
      assert.ok(html.includes('12 XLM'));
      assert.ok(html.includes('QUIT-8QM3'));
      assert.ok(html.includes(pendingInvoice.sellerPublicKey));
      assert.ok(html.includes('PENDING'));
      assert.ok(!html.includes('https://stellar.expert/explorer'));
      assert.ok(html.includes('<span class="value mono">None</span>'));
      assert.ok(html.includes('Not settled'));

      const doc = createQuittanceProofPdf(proof, jsPDF);
      const pdfText = Buffer.from(doc.output('arraybuffer')).toString('latin1');
      assert.ok(pdfText.includes('Amount: 12 XLM'));
      assert.ok(pdfText.includes('Memo: QUIT-8QM3'));
      assert.ok(pdfText.includes('Status: PENDING'));
      assert.ok(!pdfText.includes('Explorer:'));
      assert.ok(pdfText.includes('Not settled'));
    });

    it('raw invoice export enforces payment proof availability policy', () => {
      assert.equal(canExportPaymentProof(paidInvoice), true);
      assert.equal(canExportPaymentProof(pendingInvoice), false);
      assert.equal(canExportPaymentProof({ status: 'EXPIRED' }), false);

      assert.doesNotThrow(() => assertPaymentProofAvailable(paidInvoice));
      assert.throws(
        () => assertPaymentProofAvailable(pendingInvoice),
        /Payment proof is available only after the invoice is paid/
      );
      assert.throws(
        () => assertPaymentProofAvailable({ status: 'EXPIRED' }),
        /Payment proof is unavailable because this invoice expired unpaid/
      );
      assert.throws(
        () => generateInvoicePDF(pendingInvoice),
        /Payment proof is available only after the invoice is paid/
      );
    });
  });

  describe('6. CI Guardrail: Fails when any required field is dropped', () => {
    const buildDummy = (omitKey) => {
      const fields = {
        amount: expectedPaid.amount,
        assetCode: expectedPaid.assetCode,
        memo: expectedPaid.memo,
        seller: expectedPaid.seller,
        payer: expectedPaid.payer,
        txHash: expectedPaid.txHash,
        explorerUrl: expectedPaid.explorerUrl,
        status: expectedPaid.status,
      };
      if (omitKey) {
        delete fields[omitKey];
      }
      return Object.values(fields).join(' ');
    };

    it('detects when amount is missing', () => {
      const missing = checkRequiredPaidProofFields(buildDummy('amount'), expectedPaid);
      assert.deepEqual(missing, ['amount']);
    });

    it('detects when assetCode is missing', () => {
      const missing = checkRequiredPaidProofFields(buildDummy('assetCode'), expectedPaid);
      assert.deepEqual(missing, ['assetCode']);
    });

    it('detects when memo is missing', () => {
      const missing = checkRequiredPaidProofFields(buildDummy('memo'), expectedPaid);
      assert.deepEqual(missing, ['memo']);
    });

    it('detects when seller is missing', () => {
      const missing = checkRequiredPaidProofFields(buildDummy('seller'), expectedPaid);
      assert.deepEqual(missing, ['seller']);
    });

    it('detects when payer is missing', () => {
      const missing = checkRequiredPaidProofFields(buildDummy('payer'), expectedPaid);
      assert.deepEqual(missing, ['payer']);
    });

    it('detects when txHash is missing', () => {
      // Create string without txHash and without explorerUrl that embeds txHash
      const output = [
        expectedPaid.amount,
        expectedPaid.assetCode,
        expectedPaid.memo,
        expectedPaid.seller,
        expectedPaid.payer,
        expectedPaid.status,
      ].join(' ');
      const missing = checkRequiredPaidProofFields(output, expectedPaid);
      assert.ok(missing.includes('txHash'));
    });

    it('detects when explorerUrl is missing', () => {
      const missing = checkRequiredPaidProofFields(buildDummy('explorerUrl'), expectedPaid);
      assert.deepEqual(missing, ['explorerUrl']);
    });

    it('detects when status is missing', () => {
      const missing = checkRequiredPaidProofFields(buildDummy('status'), expectedPaid);
      assert.deepEqual(missing, ['status']);
    });

    it('fails with assertion error if pipeline output is modified to drop explorerUrl', () => {
      const proof = buildQuittanceProof(paidInvoice, { network: NETWORK, now: FIXED_NOW }).proof;
      const html = renderQuittanceProofHtml(proof);
      // Simulate pipeline regression where explorer link is completely dropped
      const mutatedHtml = html.replaceAll(expectedPaid.explorerUrl, 'https://dropped-link.example');

      assert.throws(
        () => assertRequiredPaidProofFields(mutatedHtml, expectedPaid, 'mutated-html'),
        /Required proof fields dropped from mutated-html output: explorerUrl/
      );
    });
  });
});
