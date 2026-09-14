/**
 * Quittance proof export controller.
 *
 * Provides canonical machine-readable and PDF proof generation for invoices.
 *
 * Schema: quittance.v1
 * Format: JSON (machine-readable) and HTML (PDF-ready)
 * Invariants: VERSIONED, AMOUNTS_ARE_STRINGS, UTC_TIMESTAMPS, NO_PAYER_PII, NO_SECRET_KEY, NO_INFERRED_OWNERSHIP, DETERMINISTIC
 */

import { Request, Response } from 'express';
import { buildQuittanceProof, serializeQuittanceProof, checkQuittanceProofInvariants } from '../services/quittance-proof.service';
import { sendSuccess, sendFailure } from '../types/api';
import { createRequestId } from '../utils/request-correlation-id';
import { logEvent, logReference } from '../observability/log-events';
import { getRequestId } from '../middleware/correlation-id';

export async function getQuittanceProof(req: Request, res: Response): Promise<void> {
  const requestId = getRequestId(req);
  try {
    const { id } = req.params;
    const network = req.query.network as string | undefined;

    // Fetch invoice from storage
    const invoice = await req.app.get('invoiceStorage').getInvoiceById(id);

    if (!invoice) {
      return sendFailure(res, 404, 'Invoice not found');
    }

    // Build the canonical quittance proof
    const result = buildQuittanceProof(
      {
        id: invoice.id,
        status: invoice.status,
        sellerPublicKey: invoice.sellerPublicKey,
        payerPublicKey: invoice.payerPublicKey,
        amount: invoice.amount,
        assetCode: invoice.assetCode,
        assetIssuer: invoice.assetIssuer,
        memo: invoice.memo,
        paymentTxHash: invoice.paymentTxHash,
        createdAt: invoice.createdAt,
        expiresAt: invoice.expiresAt,
        paidAt: invoice.paidAt,
      },
      { network }
    );

    if (!result.ok) {
      return sendFailure(res, 400, result.message);
    }

    const proof = result.proof;

    // Verify invariants (defensive check)
    const serialized = serializeQuittanceProof(proof);
    const violations = checkQuittanceProofInvariants(serialized);

    if (violations.length > 0) {
      console.error(`[quittance-proof] Invariant violations detected: ${violations.join(', ')}`);
      return sendFailure(res, 500, 'Proof generation failed: invariant violation');
    }

    logEvent('info', 'proof.downloaded', { requestId, service: 'api' }, {
      invoiceRef: logReference(invoice.id),
      txRef: logReference(invoice.paymentTxHash),
      proofFormat: 'text',
    });

    sendSuccess(res, 200, {
      ...proof,
    });
  } catch (error: any) {
    console.error(`[${requestId}] Quittance proof error:`, error);
    sendFailure(res, 500, error.message || 'Failed to generate proof');
  }
}

export async function getQuittanceProofPDF(req: Request, res: Response): Promise<void> {
  const requestId = getRequestId(req);
  try {
    const { id } = req.params;
    const network = req.query.network as string | undefined;

    const invoice = await req.app.get('invoiceStorage').getInvoiceById(id);

    if (!invoice) {
      return sendFailure(res, 404, 'Invoice not found');
    }

    const result = buildQuittanceProof(
      {
        id: invoice.id,
        status: invoice.status,
        sellerPublicKey: invoice.sellerPublicKey,
        payerPublicKey: invoice.payerPublicKey,
        amount: invoice.amount,
        assetCode: invoice.assetCode,
        assetIssuer: invoice.assetIssuer,
        memo: invoice.memo,
        paymentTxHash: invoice.paymentTxHash,
        createdAt: invoice.createdAt,
        expiresAt: invoice.expiresAt,
        paidAt: invoice.paidAt,
      },
      { network }
    );

    if (!result.ok) {
      return sendFailure(res, 400, result.message);
    }

    const proof = result.proof;

    const serialized = serializeQuittanceProof(proof);
    const violations = checkQuittanceProofInvariants(serialized);

    if (violations.length > 0) {
      return sendFailure(res, 500, 'PDF generation failed: invariant violation');
    }

    const html = generateProofHTML(proof, invoice);

    logEvent('info', 'proof.downloaded', { requestId, service: 'api' }, {
      invoiceRef: logReference(invoice.id),
      txRef: logReference(invoice.paymentTxHash),
      proofFormat: 'pdf',
    });

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Content-Disposition', `inline; filename="quittance-${invoice.id}.html"`);
    res.send(html);
  } catch (error: any) {
    console.error(`[${requestId}] Quittance PDF error:`, error);
    sendFailure(res, 500, error.message || 'Failed to generate PDF');
  }
}

/**
 * Generate HTML proof document.
 * This is the same template used in frontend/lib/export.ts but rendered server-side.
 */
function generateProofHTML(proof: any, invoice: any): string {
  const network = proof.network === 'testnet' ? 'Testnet' : 'Mainnet';
  const isPaid = proof.status === 'PAID';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Quittance Proof - ${invoice.id}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: Arial, sans-serif; 
      padding: 40px; 
      color: #333; 
      background: white; 
      max-width: 800px; 
      margin: 0 auto;
    }
    h1 { font-size: 24px; margin-bottom: 24px; color: #1a1a1a; }
    h2 { font-size: 16px; margin: 24px 0 12px; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .row { display: flex; margin-bottom: 12px; }
    .label { font-weight: bold; min-width: 140px; color: #555; }
    .value { flex: 1; font-family: monospace; }
    .section { margin-bottom: 24px; }
    .badge { 
      display: inline-block; 
      padding: 4px 12px; 
      border-radius: 12px; 
      font-size: 12px; 
      font-weight: bold; 
      text-transform: uppercase;
    }
    .badge-paid { background: #e6f3ff; color: #0066cc; }
    .badge-pending { background: #fff3e0; color: #e65100; }
    .badge-expired { background: #ffebee; color: #c62828; }
    .badge-cancelled { background: #f5f5f5; color: #616161; }
    pre {
      background: #f5f5f5;
      padding: 16px;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 12px;
    }
    .explorer-link {
      word-break: break-all;
      color: #0066cc;
      text-decoration: none;
    }
    .explorer-link:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      font-size: 12px;
      color: #888;
    }
    @media print {
      body { padding: 20px; }
      h1 { font-size: 18px; }
      .section { margin-bottom: 16px; }
      pre { padding: 8px; }
    }
  </style>
</head>
<body>
  <h1>Quittance Proof</h1>
  
  <div class="section">
    <h2>Invoice Details</h2>
    <div class="row">
      <span class="label">Invoice ID:</span>
      <span class="value">${invoice.id}</span>
    </div>
    <div class="row">
      <span class="label">Status:</span>
      <span class="value">
        <span class="badge badge-${proof.status.toLowerCase()}">${proof.status}</span>
      </span>
    </div>
    <div class="row">
      <span class="label">Network:</span>
      <span class="value">${network}</span>
    </div>
    <div class="row">
      <span class="label">Date:</span>
      <span class="value">${proof.issuedAt}</span>
    </div>
    ${isPaid ? `
    <div class="row">
      <span class="label">Paid:</span>
      <span class="value">${proof.settledAt}</span>
    </div>
    ` : ''}
  </div>

  <div class="section">
    <h2>Payment</h2>
    <div class="row">
      <span class="label">Amount:</span>
      <span class="value">${proof.payment.amount} ${proof.payment.asset.code}</span>
    </div>
    ${proof.payment.asset.issuer ? `
    <div class="row">
      <span class="label">Asset Issuer:</span>
      <span class="value">${proof.payment.asset.issuer}</span>
    </div>
    ` : ''}
    <div class="row">
      <span class="label">Memo:</span>
      <span class="value">${proof.payment.memo || '(none)'}</span>
    </div>
    ${isPaid ? `
    <div class="row">
      <span class="label">Transaction Hash:</span>
      <span class="value">
        <a href="${proof.payment.explorerUrl}" class="explorer-link" target="_blank" rel="noopener">
          ${proof.payment.txHash}
        </a>
      </span>
    </div>
    ` : ''}
    ${isPaid ? `
    <div class="row">
      <span class="label">Verification:</span>
      <span class="value">Verified via memo and amount match</span>
    </div>
    ` : ''}
  </div>

  <div class="section">
    <h2>Parties</h2>
    <div class="row">
      <span class="label">Seller:</span>
      <span class="value">${proof.seller}</span>
    </div>
    ${proof.payer ? `
    <div class="row">
      <span class="label">Payer:</span>
      <span class="value">${proof.payer}</span>
    </div>
    ` : '<div class="row"><span class="label">Payer:</span><span class="value">(not yet paid)</span></div>'}
  </div>

  ${isPaid ? `
  <div class="section">
    <h2>Verification Result</h2>
    <div class="row">
      <span class="label">Status:</span>
      <span class="value">
        <span class="badge badge-paid">VERIFIED</span>
      </span>
    </div>
    <div class="row">
      <span class="label">Method:</span>
      <span class="value">Memo and amount match</span>
    </div>
    <div class="row">
      <span class="label">Checked At:</span>
      <span class="value">${proof.verification.checkedAt}</span>
    </div>
  </div>
  ` : ''}

  <div class="section">
    <h2>Machine-Readable Proof (JSON)</h2>
    <pre><code>${serializeQuittanceProof(proof)}</code></pre>
  </div>

  <div class="footer">
    <p>Generated by Quittance on ${proof.document.generatedAtUtc}</p>
    <p>This document proves payment for invoice ${invoice.id} on the ${network} Stellar network.</p>
  </div>

  <script>
    window.print();
  </script>
</body>
</html>`;
}

export default {
  getQuittanceProof,
  getQuittanceProofPDF,
};
