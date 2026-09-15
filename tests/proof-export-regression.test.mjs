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
} = await import('../frontend/tests/fixtures/quittance-proof.fixture.js');

/**
 * Check whether all required paid proof fields appear in the given export output.
 *
 * @param {string} output - Rendered text or HTML from export.
 * @param {Record<string, string>} expected - Expected values for required fields.
 * @returns {string[]} Array of field keys missing from the output.
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

/**
 * Assert that all required paid proof fields are present in the export output.
 *
 * @param {string} output - Rendered text or HTML from export.
 * @param {Record<string, string>} expected - Expected values for required fields.
 * @param {string} context - Target export context identifier.
 */
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

  describe('Paid QuittanceProof HTML Export', () => {
    it('renders all required canonical fields in renderQuittanceProofHtml', () => {
      const proofResult = buildQuittanceProof(paidInvoice, { network: NETWORK, now: FIXED_NOW });
      assert.equal(proofResult.ok, true);
      const html = renderQuittanceProofHtml(proofResult.proof);

      assertRequiredPaidProofFields(html, expectedPaid, 'renderQuittanceProofHtml');
      assert.ok(html.includes(expectedPaid.assetIssuer), 'Must include asset issuer');
      assert.ok(html.includes(expectedPaid.schemaVersion), 'Must include schema version');
      assert.ok(html.includes(proofResult.proof.invoiceId), 'Must include invoiceId');
    });

    it('renders identical output via generateQuittanceProofPDF', () => {
      const proofResult = buildQuittanceProof(paidInvoice, { network: NETWORK, now: FIXED_NOW });
      assert.equal(proofResult.ok, true);
      const html = generateQuittanceProofPDF(proofResult.proof);

      assertRequiredPaidProofFields(html, expectedPaid, 'generateQuittanceProofPDF');
      assert.equal(html, renderQuittanceProofHtml(proofResult.proof));
    });
  });

  describe('Paid Raw Invoice HTML Export', () => {
    it('renders all required fields including txHash and explorerUrl in generateInvoicePDF', () => {
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

  describe('Paid jsPDF Document Export', () => {
    it('encodes all required fields in createQuittanceProofPdf output', () => {
      const proofResult = buildQuittanceProof(paidInvoice, { network: NETWORK, now: FIXED_NOW });
      assert.equal(proofResult.ok, true);
      const doc = createQuittanceProofPdf(proofResult.proof, jsPDF);
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

  describe('Network-Aware Explorer URLs', () => {
    it('constructs public explorer links when network is public', () => {
      const proofResult = buildQuittanceProof(paidInvoice, { network: 'public', now: FIXED_NOW });
      assert.equal(proofResult.ok, true);
      assert.equal(proofResult.proof.network, 'public');
      assert.equal(proofResult.proof.payment.explorerUrl, expectedPaid.publicExplorerUrl);

      const html = renderQuittanceProofHtml(proofResult.proof);
      assert.ok(html.includes(expectedPaid.publicExplorerUrl));
      assert.ok(!html.includes('explorer/testnet/tx'));

      const doc = createQuittanceProofPdf(proofResult.proof, jsPDF);
      const pdfText = Buffer.from(doc.output('arraybuffer')).toString('latin1');
      assert.ok(pdfText.includes(expectedPaid.publicExplorerUrl));
    });
  });

  describe('Unpaid and Pending Invoice Invariants', () => {
    it('unpaid QuittanceProof omits settlement fields and explorer link', () => {
      const proofResult = buildQuittanceProof(pendingInvoice, { network: NETWORK, now: FIXED_NOW });
      assert.equal(proofResult.ok, true);
      const proof = proofResult.proof;
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

  describe('CI Guardrail Negative Assertions', () => {
    const buildOmittedOutput = (omitKey) => {
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

    it('detects missing amount', () => {
      const missing = checkRequiredPaidProofFields(buildOmittedOutput('amount'), expectedPaid);
      assert.deepEqual(missing, ['amount']);
    });

    it('detects missing assetCode', () => {
      const missing = checkRequiredPaidProofFields(buildOmittedOutput('assetCode'), expectedPaid);
      assert.deepEqual(missing, ['assetCode']);
    });

    it('detects missing memo', () => {
      const missing = checkRequiredPaidProofFields(buildOmittedOutput('memo'), expectedPaid);
      assert.deepEqual(missing, ['memo']);
    });

    it('detects missing seller', () => {
      const missing = checkRequiredPaidProofFields(buildOmittedOutput('seller'), expectedPaid);
      assert.deepEqual(missing, ['seller']);
    });

    it('detects missing payer', () => {
      const missing = checkRequiredPaidProofFields(buildOmittedOutput('payer'), expectedPaid);
      assert.deepEqual(missing, ['payer']);
    });

    it('detects missing txHash', () => {
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

    it('detects missing explorerUrl', () => {
      const missing = checkRequiredPaidProofFields(buildOmittedOutput('explorerUrl'), expectedPaid);
      assert.deepEqual(missing, ['explorerUrl']);
    });

    it('detects missing status', () => {
      const missing = checkRequiredPaidProofFields(buildOmittedOutput('status'), expectedPaid);
      assert.deepEqual(missing, ['status']);
    });

    it('fails when explorerUrl is dropped from pipeline output', () => {
      const proofResult = buildQuittanceProof(paidInvoice, { network: NETWORK, now: FIXED_NOW });
      assert.equal(proofResult.ok, true);
      const html = renderQuittanceProofHtml(proofResult.proof);
      const strippedHtml = html.replaceAll(expectedPaid.explorerUrl, 'https://dropped.example');

      assert.throws(
        () => assertRequiredPaidProofFields(strippedHtml, expectedPaid, 'strippedHtml'),
        /Required proof fields dropped from strippedHtml output: explorerUrl/
      );
    });
  });
});
