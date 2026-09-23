import { buildHorizonTxUrl } from './explorer-tx-link.ts';
import {
  resolveStellarNetwork,
  explorerSegmentFor,
} from '../../shared/network.ts';

export const QUITTANCE_PROOF_VERSION = 'quittance.v1';

/** Fixed, documented field order - JSON key order must not depend on input. */
export const QUITTANCE_PROOF_FIELDS = [
  'schemaVersion',
  'invoiceId',
  'network',
  'status',
  'issuedAt',
  'dueAt',
  'settledAt',
  'seller',
  'payer',
  'payment',
  'verification',
  'document',
] as const;

export type QuittanceProofField = (typeof QUITTANCE_PROOF_FIELDS)[number];

export interface QuittanceProofAsset {
  code: string;
  issuer: string | null;
}

export interface QuittanceProofPayment {
  txHash: string;
  memo: string | null;
  amount: string;
  asset: QuittanceProofAsset;
  explorerUrl: string | null;
}

export interface QuittanceProof {
  schemaVersion: string;
  invoiceId: string;
  network: 'testnet' | 'public';
  status: 'PAID' | 'PENDING' | 'EXPIRED' | 'CANCELLED';
  issuedAt: string;
  dueAt: string;
  settledAt: string | null;
  seller: string;
  payer: string | null;
  payment: QuittanceProofPayment;
  verification: {
    status: 'verified' | 'unverified';
    method: 'memo-and-amount' | 'none';
    checkedAt: string | null;
  };
  document: {
    generatedAtUtc: string;
    generatedBy: 'quittance-web';
  };
}

/** Shape this module accepts. Mirrors the invoice shape the app already has. */
export interface QuittanceProofInput {
  id?: string;
  status?: string;
  sellerPublicKey?: string;
  payerPublicKey?: string | null;
  amount?: string | number | null;
  assetCode?: string | null;
  assetIssuer?: string | null;
  memo?: string | null;
  paymentTxHash?: string | null;
  expiresAt?: string | Date | null;
  createdAt?: string | Date | null;
  paidAt?: string | Date | null;
  settledAt?: string | Date | null;
  network?: string | null;
}

export interface QuittanceProofOptions {
  network?: string | null;
  /** Injected clock: determinism has to be testable. */
  now?: Date;
}

export type QuittanceProofResult =
  | { ok: true; proof: QuittanceProof }
  | { ok: false; code: string; message: string };

const TX_HASH_PATTERN = /^[a-fA-F0-9]{64}$/;
const AMOUNT_PATTERN = /^\d+(?:\.\d{1,7})?$/;
const SECRET_KEY_PATTERN = /S[A-Z2-7]{55}/;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;

function utcIso(value: string | Date | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeAmount(value: string | number | null | undefined): string | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return normalizeAmount(value.toFixed(7));
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!AMOUNT_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  if (fraction === '') return whole;
  return whole + '.' + fraction.padEnd(7, '0').slice(0, 7);
}

function normalizeNetwork(network: string | null | undefined): 'testnet' | 'public' {
  if (!network) {
    return explorerSegmentFor(
      resolveStellarNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK)
    );
  }
  const lower = network.trim().toLowerCase();
  return lower === 'public' || lower === 'mainnet' ? 'public' : 'testnet';
}

function isSettled(status: string): boolean {
  return status === 'PAID';
}

function escapeHtml(unsafe: unknown): string {
  return String(unsafe ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Check if an unknown value conforms to the QuittanceProof contract.
 *
 * @param value - Candidate object to inspect.
 * @returns True when value carries the canonical schema version.
 */
export function isQuittanceProof(value: unknown): value is QuittanceProof {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as QuittanceProof).schemaVersion === QUITTANCE_PROOF_VERSION
  );
}

/**
 * Build the canonical document for one invoice.
 *
 * @param input - Invoice records to derive the proof from.
 * @param options - Network selection and injected clock for determinism.
 * @returns Validated proof or structured error code.
 */
export function buildQuittanceProof(
  input: QuittanceProofInput,
  options: QuittanceProofOptions = {}
): QuittanceProofResult {
  const invoiceId = typeof input.id === 'string' ? input.id.trim() : '';
  if (invoiceId === '') {
    return { ok: false, code: 'MISSING_INVOICE_ID', message: 'Invoice id is required for a proof.' };
  }

  const seller = typeof input.sellerPublicKey === 'string' ? input.sellerPublicKey.trim() : '';
  if (seller === '') {
    return { ok: false, code: 'MISSING_SELLER', message: 'The invoice has no seller account to prove against.' };
  }

  const amount = normalizeAmount(input.amount);
  if (amount === null) {
    return {
      ok: false,
      code: 'INVALID_AMOUNT',
      message: 'Amount must be a positive decimal with at most 7 decimal places.',
    };
  }

  const status = typeof input.status === 'string' ? input.status : 'PENDING';
  const network = normalizeNetwork(options.network ?? input.network ?? process.env.NEXT_PUBLIC_STELLAR_NETWORK);
  const settled = isSettled(status);

  let txHash: string | null = null;
  if (settled) {
    const candidate = typeof input.paymentTxHash === 'string' ? input.paymentTxHash.trim() : '';
    if (!TX_HASH_PATTERN.test(candidate)) {
      return {
        ok: false,
        code: 'INVALID_TX_HASH',
        message: 'A settled invoice needs its 64-character transaction hash to build a proof.',
      };
    }
    txHash = candidate.toLowerCase();
  }

  const checkedAt = settled ? utcIso(input.settledAt ?? input.paidAt) : null;
  const generatedAt = (options.now ?? new Date()).toISOString();

  const proof: QuittanceProof = {
    schemaVersion: QUITTANCE_PROOF_VERSION,
    invoiceId,
    network,
    status: (['PAID', 'PENDING', 'EXPIRED', 'CANCELLED'].includes(status) ? status : 'PENDING') as QuittanceProof['status'],
    issuedAt: utcIso(input.createdAt) ?? generatedAt,
    dueAt: utcIso(input.expiresAt) ?? generatedAt,
    settledAt: settled ? checkedAt : null,
    seller,
    payer: typeof input.payerPublicKey === 'string' && input.payerPublicKey.trim() !== ''
      ? input.payerPublicKey.trim()
      : null,
    payment: {
      txHash: txHash ?? '',
      memo: typeof input.memo === 'string' && input.memo !== '' ? input.memo : null,
      amount,
      asset: {
        code: typeof input.assetCode === 'string' && input.assetCode !== '' ? input.assetCode : 'XLM',
        issuer: typeof input.assetIssuer === 'string' && input.assetIssuer !== '' ? input.assetIssuer : null,
      },
      explorerUrl: txHash ? buildHorizonTxUrl(txHash, network) : null,
    },
    verification: settled
      ? { status: 'verified', method: 'memo-and-amount', checkedAt }
      : { status: 'unverified', method: 'none', checkedAt: null },
    document: { generatedAtUtc: generatedAt, generatedBy: 'quittance-web' },
  };

  return { ok: true, proof };
}

/** Ordered copy so serialized key order is a property of the schema. */
function ordered(proof: QuittanceProof): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of QUITTANCE_PROOF_FIELDS) {
    out[field] = proof[field as QuittanceProofField];
  }
  return out;
}

/**
 * Machine-readable export with fixed field order.
 *
 * @param proof - Canonical quittance proof model.
 * @returns Deterministic JSON string representation.
 */
export function serializeQuittanceProof(proof: QuittanceProof): string {
  return JSON.stringify(ordered(proof), null, 2) + '\n';
}

/**
 * Parse an exported document back, or null when it does not match this schema.
 *
 * @param json - Serialized JSON string.
 * @returns Parsed QuittanceProof or null.
 */
export function parseQuittanceProof(json: string): QuittanceProof | null {
  try {
    const parsed = JSON.parse(json) as QuittanceProof;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.schemaVersion !== QUITTANCE_PROOF_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Check the invariants against a serialized document.
 *
 * @param serialized - JSON string representation of a proof.
 * @returns Array of violated invariant names; empty array means valid.
 */
export function checkQuittanceProofInvariants(serialized: string): string[] {
  const violated: string[] = [];
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return ['NOT_JSON'];
  }
  if (!parsed) return ['NOT_JSON'];

  if (parsed.schemaVersion !== QUITTANCE_PROOF_VERSION) violated.push('VERSIONED');

  if (SECRET_KEY_PATTERN.test(serialized)) violated.push('NO_SECRET_KEY');
  if (EMAIL_PATTERN.test(serialized)) violated.push('NO_PAYER_PII');

  const payment = (parsed.payment ?? {}) as Record<string, unknown>;
  if (typeof payment.amount !== 'string') violated.push('AMOUNTS_ARE_STRINGS');

  for (const key of ['issuedAt', 'dueAt', 'settledAt', 'document']) {
    const value = parsed[key];
    if (key === 'document') {
      const doc = (value ?? {}) as Record<string, unknown>;
      if (typeof doc.generatedAtUtc !== 'string' || !doc.generatedAtUtc.endsWith('Z')) {
        violated.push('UTC_TIMESTAMPS');
      }
      continue;
    }
    if (value !== null && (typeof value !== 'string' || !value.endsWith('Z'))) {
      violated.push('UTC_TIMESTAMPS');
    }
  }

  const payer = parsed.payer;
  if (payer !== null && payer !== undefined && typeof payer !== 'string') {
    violated.push('SINGLE_COUNTERPARTY');
  }

  return violated;
}

/**
 * Render the canonical quittance proof document into print-ready HTML.
 *
 * @param proof - Canonical quittance proof model.
 * @returns Complete HTML document string formatted for browser printing to PDF.
 */
export function renderQuittanceProofHtml(proof: QuittanceProof): string {
  const isPaid = proof.status === 'PAID';
  const badgeClass = isPaid ? 'badge-paid' : proof.status === 'PENDING' ? 'badge-pending' : 'badge-other';

  const explorerHtml = proof.payment.explorerUrl
    ? `<a href="${escapeHtml(proof.payment.explorerUrl)}" target="_blank" rel="noopener noreferrer" class="link mono">${escapeHtml(proof.payment.explorerUrl)}</a>`
    : `<span class="value mono">None</span>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Payment Proof #${escapeHtml(proof.invoiceId)} - Quittance</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 15mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      background-color: #f9fafb;
      padding: 24px;
      font-size: 14px;
      line-height: 1.5;
    }
    .proof-container {
      max-width: 800px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 32px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0284c7;
      padding-bottom: 20px;
      margin-bottom: 24px;
    }
    .brand {
      font-size: 26px;
      font-weight: 800;
      color: #0284c7;
      letter-spacing: -0.025em;
    }
    .schema-version {
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #6b7280;
      margin-top: 4px;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-paid {
      background: #dcfce7;
      color: #15803d;
    }
    .badge-pending {
      background: #fef9c3;
      color: #854d0e;
    }
    .badge-other {
      background: #f3f4f6;
      color: #4b5563;
    }
    .network-badge {
      font-size: 11px;
      font-weight: 600;
      color: #6b7280;
      text-transform: uppercase;
      margin-top: 6px;
      text-align: right;
    }
    .amount-card {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      padding: 20px;
      text-align: center;
      margin-bottom: 24px;
    }
    .amount-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #166534;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .amount-figure {
      font-size: 30px;
      font-weight: 800;
      color: #14532d;
    }
    .asset-issuer {
      font-size: 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: #15803d;
      margin-top: 4px;
    }
    .section {
      margin-bottom: 24px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      color: #6b7280;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #f3f4f6;
      padding-bottom: 6px;
      margin-bottom: 12px;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .field {
      margin-bottom: 10px;
    }
    .label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: #9ca3af;
      margin-bottom: 2px;
    }
    .value {
      font-size: 13px;
      color: #1f2937;
      word-break: break-all;
    }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
    }
    .link {
      color: #0284c7;
      text-decoration: none;
    }
    .link:hover {
      text-decoration: underline;
    }
    .footer {
      border-top: 1px solid #f3f4f6;
      padding-top: 16px;
      margin-top: 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #9ca3af;
    }
    .print-control {
      position: fixed;
      top: 16px;
      right: 16px;
      background: #0284c7;
      color: #ffffff;
      padding: 12px 16px;
      border-radius: 8px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      z-index: 1000;
      max-width: 240px;
    }
    .print-btn {
      background: #ffffff;
      color: #0284c7;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      margin-top: 8px;
      cursor: pointer;
      font-weight: 700;
      font-size: 12px;
      width: 100%;
    }
    @media print {
      body {
        background-color: #ffffff;
        padding: 0;
      }
      .proof-container {
        border: none;
        padding: 0;
        max-width: 100%;
      }
      .no-print {
        display: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="print-control no-print">
    <div style="font-weight:700;margin-bottom:2px;">Payment Proof</div>
    <div style="font-size:11px;">Save as PDF or print</div>
    <button class="print-btn" onclick="window.print()">Save as PDF</button>
  </div>
  <div class="proof-container">
    <div class="header">
      <div>
        <div class="brand">Quittance</div>
        <div class="schema-version">Schema: ${escapeHtml(proof.schemaVersion)}</div>
      </div>
      <div>
        <div style="text-align:right;"><span class="badge ${badgeClass}">${escapeHtml(proof.status)}</span></div>
        <div class="network-badge">Network: ${escapeHtml(proof.network)}</div>
      </div>
    </div>

    <div class="amount-card">
      <div class="amount-label">Settled Amount</div>
      <div class="amount-figure">${escapeHtml(proof.payment.amount)} ${escapeHtml(proof.payment.asset.code)}</div>
      ${proof.payment.asset.issuer ? `<div class="asset-issuer">Issuer: ${escapeHtml(proof.payment.asset.issuer)}</div>` : ''}
    </div>

    <div class="section">
      <div class="section-title">Invoice & Timestamps</div>
      <div class="grid-2">
        <div class="field">
          <div class="label">Invoice ID</div>
          <div class="value mono">${escapeHtml(proof.invoiceId)}</div>
        </div>
        <div class="field">
          <div class="label">Issued At (UTC)</div>
          <div class="value mono">${escapeHtml(proof.issuedAt)}</div>
        </div>
        <div class="field">
          <div class="label">Due At (UTC)</div>
          <div class="value mono">${escapeHtml(proof.dueAt)}</div>
        </div>
        <div class="field">
          <div class="label">Settled At (UTC)</div>
          <div class="value mono">${escapeHtml(proof.settledAt ?? 'Not settled')}</div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Counterparties</div>
      <div class="field">
        <div class="label">Seller (Recipient)</div>
        <div class="value mono">${escapeHtml(proof.seller)}</div>
      </div>
      <div class="field">
        <div class="label">Payer</div>
        <div class="value mono">${escapeHtml(proof.payer ?? 'Not recorded')}</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Settlement Verification</div>
      <div class="grid-2">
        <div class="field">
          <div class="label">Verification Status</div>
          <div class="value">${escapeHtml(proof.verification.status)}</div>
        </div>
        <div class="field">
          <div class="label">Verification Method</div>
          <div class="value">${escapeHtml(proof.verification.method)}</div>
        </div>
        <div class="field">
          <div class="label">Verified At (UTC)</div>
          <div class="value mono">${escapeHtml(proof.verification.checkedAt ?? 'N/A')}</div>
        </div>
        <div class="field">
          <div class="label">Memo</div>
          <div class="value mono">${escapeHtml(proof.payment.memo ?? 'None')}</div>
        </div>
      </div>
      <div class="field" style="margin-top:8px;">
        <div class="label">Transaction Hash</div>
        <div class="value mono">${escapeHtml(proof.payment.txHash || 'None')}</div>
      </div>
      <div class="field">
        <div class="label">Explorer Record</div>
        <div class="value">${explorerHtml}</div>
      </div>
    </div>

    <div class="footer">
      <div>Generated at ${escapeHtml(proof.document.generatedAtUtc)} by ${escapeHtml(proof.document.generatedBy)}</div>
      <div>Canonical Quittance Proof (${escapeHtml(proof.schemaVersion)})</div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Render a deterministic jsPDF document from a canonical quittance proof.
 *
 * @param proof - Canonical quittance proof model.
 * @param jsPdfCtor - Optional injected jsPDF constructor.
 * @returns Configured jsPDF instance with fixed creation date and file ID.
 */
export function createQuittanceProofPdf(
  proof: QuittanceProof,
  jsPdfCtor?: unknown
): any {
  const Ctor: any = jsPdfCtor ?? (globalThis as any).jsPDF;
  if (!Ctor) {
    throw new Error('jsPDF constructor must be provided or available on globalThis.jsPDF');
  }

  const doc = new Ctor({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    putOnlyUsedFonts: true,
  });

  const generatedDate = new Date(proof.document.generatedAtUtc);
  doc.setCreationDate(Number.isNaN(generatedDate.getTime()) ? new Date(0) : generatedDate);
  doc.setFileId('00000000000000000000000000000000');

  doc.setFontSize(22);
  doc.setTextColor(2, 132, 199);
  doc.text('QUITTANCE', 14, 20);

  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text(`Canonical Payment Proof (${proof.schemaVersion})`, 14, 26);

  doc.setDrawColor(229, 231, 235);
  doc.line(14, 30, 196, 30);

  doc.setFontSize(11);
  doc.setTextColor(17, 24, 39);
  doc.text(`Invoice ID: ${proof.invoiceId}`, 14, 38);
  doc.text(`Status: ${proof.status}`, 14, 45);
  doc.text(`Network: ${proof.network}`, 14, 52);

  doc.setFontSize(14);
  doc.setTextColor(20, 83, 45);
  doc.text(`Amount: ${proof.payment.amount} ${proof.payment.asset.code}`, 14, 62);

  doc.setFontSize(10);
  doc.setTextColor(75, 85, 99);
  doc.text(`Seller: ${proof.seller}`, 14, 72);
  doc.text(`Payer: ${proof.payer || 'Not recorded'}`, 14, 79);

  doc.text(`Memo: ${proof.payment.memo || 'None'}`, 14, 89);
  doc.text(`Transaction Hash: ${proof.payment.txHash || 'None'}`, 14, 96);
  if (proof.payment.explorerUrl) {
    doc.text(`Explorer: ${proof.payment.explorerUrl}`, 14, 103);
  }

  doc.text(`Verification: ${proof.verification.status} (${proof.verification.method})`, 14, 113);
  doc.text(`Issued At (UTC): ${proof.issuedAt}`, 14, 120);
  doc.text(`Due At (UTC): ${proof.dueAt}`, 14, 127);
  doc.text(`Settled At (UTC): ${proof.settledAt || 'Not settled'}`, 14, 134);

  doc.line(14, 142, 196, 142);
  doc.setFontSize(8);
  doc.setTextColor(156, 163, 175);
  doc.text(`Generated At (UTC): ${proof.document.generatedAtUtc}`, 14, 148);
  doc.text(`Generated By: ${proof.document.generatedBy}`, 14, 153);
  doc.text('Anchor: Stellar Horizon consensus verification', 14, 158);

  return doc;
}

const quittanceProof = {
  buildQuittanceProof,
  serializeQuittanceProof,
  parseQuittanceProof,
  checkQuittanceProofInvariants,
  isQuittanceProof,
  renderQuittanceProofHtml,
  createQuittanceProofPdf,
  QUITTANCE_PROOF_VERSION,
  QUITTANCE_PROOF_FIELDS,
};

export default quittanceProof;
