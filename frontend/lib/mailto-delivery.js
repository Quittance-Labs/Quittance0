/**
 * Mailto delivery helpers for sending invoices and emailing payment proofs.
 * Pure logic shared across frontend components, export module, and test runner.
 */

const { assertPaymentProofAvailable, canExportPaymentProof } = require('./payment-proof-policy.js');
const { buildHorizonTxUrl } = require('./stellar-explorer.js');
const { buildQuittanceProof, isQuittanceProof } = require('./quittance-proof.ts');

// Same default as lib/stellar.ts: without NEXT_PUBLIC_STELLAR_NETWORK the app
// talks to testnet, so explorer links must point there too.
const DEFAULT_STELLAR_NETWORK = 'TESTNET';

function isValidEmailFormat(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function resolvePayUrl(invoiceId, baseUrl) {
  const origin = baseUrl ||
    (typeof window !== 'undefined' && window.location && window.location.origin) ||
    (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_APP_URL) ||
    'http://localhost:3000';
  return `${origin.replace(/\/+$/, '')}/pay/${invoiceId}`;
}

function formatDateDisplay(dateValue) {
  if (!dateValue) return '';
  try {
    const d = new Date(dateValue);
    if (Number.isNaN(d.getTime())) return String(dateValue);
    return d.toUTCString();
  } catch {
    return String(dateValue);
  }
}

function canSendInvoiceEmail(invoice) {
  if (!invoice || !invoice.customerEmail) return false;
  return isValidEmailFormat(invoice.customerEmail);
}

function getInvoiceMailtoRecipient(invoice) {
  if (!invoice) return '';
  return (invoice.customerEmail || '').trim();
}

function canSendProofEmail(invoice) {
  if (!canExportPaymentProof(invoice)) return false;
  const recipient = (invoice?.customerEmail || invoice?.payerEmail || '').trim();
  return isValidEmailFormat(recipient);
}

function getProofMailtoRecipient(invoice) {
  if (!invoice) return '';
  return (invoice.customerEmail || invoice.payerEmail || '').trim();
}

/**
 * Explorer network for an invoice: the invoice's own network wins, then the
 * app configuration, then the app default (TESTNET, as in lib/stellar.ts).
 */
function resolveInvoiceNetwork(invoice) {
  const configured =
    (invoice && invoice.network) ||
    (typeof process !== 'undefined' && process.env && process.env.NEXT_PUBLIC_STELLAR_NETWORK) ||
    DEFAULT_STELLAR_NETWORK;
  const normalized = String(configured).trim().toUpperCase();
  return normalized === 'PUBLIC' || normalized === 'MAINNET' ? 'public' : 'testnet';
}

function buildInvoiceMailto(invoice, baseUrl) {
  if (!invoice) {
    throw new Error('Invoice is required to build mailto link');
  }

  const recipient = getInvoiceMailtoRecipient(invoice);
  if (!recipient) {
    throw new Error('Client email is required to send this invoice');
  }

  const shortId = (invoice.id || '').substring(0, 8).toUpperCase();
  const subject = `Invoice #${shortId} - ${invoice.amount} ${invoice.assetCode || 'XLM'}`;
  const payUrl = resolvePayUrl(invoice.id, baseUrl);

  const lines = [
    'Invoice Details:',
    `Invoice ID: ${invoice.id}`,
    `Amount: ${invoice.amount} ${invoice.assetCode || 'XLM'}`,
    `Status: ${invoice.status || 'PENDING'}`,
  ];

  if (invoice.customerName) {
    lines.push(`Client: ${invoice.customerName}`);
  }
  if (invoice.sellerName) {
    lines.push(`Seller: ${invoice.sellerName}`);
  }
  if (invoice.description) {
    lines.push(`Description: ${invoice.description}`);
  }
  if (invoice.memo) {
    lines.push(`Memo: ${invoice.memo}`);
  }
  if (invoice.expiresAt) {
    lines.push(`Expires: ${formatDateDisplay(invoice.expiresAt)}`);
  }

  lines.push('');
  lines.push(`Payment Link: ${payUrl}`);
  lines.push('');
  lines.push('Powered by Quittance');

  const body = lines.join('\n');
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Builds a mailto link for sending payment proof to the client or payer.
 *
 * @param invoiceOrProof - Paid invoice or canonical QuittanceProof object.
 * @param baseUrl - Optional base application URL for pay link resolution.
 * @returns Encoded mailto URL string.
 */
function buildProofMailto(invoiceOrProof, baseUrl, recipientOverride) {
  if (!invoiceOrProof) {
    throw new Error('Invoice or proof is required to build mailto link');
  }

  const isProof = isQuittanceProof(invoiceOrProof);
  const invoice = isProof ? null : invoiceOrProof;
  let proof = isProof ? invoiceOrProof : null;

  if (invoice) {
    assertPaymentProofAvailable(invoice);
  }

  const recipient =
    typeof recipientOverride === 'string' && recipientOverride.trim()
      ? recipientOverride.trim()
      : getProofMailtoRecipient(invoice || proof);
  if (!recipient) {
    throw new Error('Client or payer email is required to email payment proof');
  }

  const network = proof ? proof.network : resolveInvoiceNetwork(invoice);

  if (!proof && invoice) {
    const proofRes = buildQuittanceProof(invoice, { network });
    if (proofRes.ok) {
      proof = proofRes.proof;
    }
  }

  const invoiceId = proof ? proof.invoiceId : invoice.id;
  const shortId = (invoiceId || '').substring(0, 8).toUpperCase();
  const amount = (invoice && invoice.amount != null) ? invoice.amount : (proof ? proof.payment.amount : '');
  const assetCode = proof ? proof.payment.asset.code : (invoice ? (invoice.assetCode || 'XLM') : 'XLM');
  const subject = `Payment Proof - Invoice #${shortId} - ${amount} ${assetCode}`;
  const payUrl = resolvePayUrl(invoiceId, baseUrl);
  const explorerUrl = (proof && proof.payment.explorerUrl)
    ? proof.payment.explorerUrl
    : (invoice && invoice.paymentTxHash ? buildHorizonTxUrl(invoice.paymentTxHash, network) : null);

  const status = proof ? proof.status : (invoice ? invoice.status : 'PAID');
  const lines = [
    'Payment Proof Details:',
    `Invoice ID: ${invoiceId}`,
    `Amount Paid: ${amount} ${assetCode}`,
    `Status: ${status}`,
  ];

  const settledDate = proof ? proof.settledAt : (invoice ? (invoice.paidAt || invoice.settledAt) : null);
  if (settledDate) {
    lines.push(`Payment Date: ${formatDateDisplay(settledDate)}`);
  }
  const txHash = proof ? proof.payment.txHash : (invoice ? invoice.paymentTxHash : null);
  if (txHash) {
    lines.push(`Transaction Hash: ${txHash}`);
  }
  if (explorerUrl) {
    lines.push(`Explorer: ${explorerUrl}`);
  }
  const seller = proof ? proof.seller : (invoice ? invoice.sellerPublicKey : null);
  if (seller) {
    lines.push(`Seller Address: ${seller}`);
  }
  const payer = proof ? proof.payer : (invoice ? invoice.payerPublicKey : null);
  if (payer) {
    lines.push(`Payer Address: ${payer}`);
  }
  if (invoice && invoice.customerName) {
    lines.push(`Client Name: ${invoice.customerName}`);
  }
  if (invoice && invoice.payerName) {
    lines.push(`Payer Name: ${invoice.payerName}`);
  }
  const memo = proof ? proof.payment.memo : (invoice ? invoice.memo : null);
  if (memo) {
    lines.push(`Memo: ${memo}`);
  }

  lines.push('');
  lines.push(`View Proof / Payment Details: ${payUrl}`);
  lines.push('Verified on Stellar Blockchain');
  lines.push('');
  lines.push('Powered by Quittance');

  const body = lines.join('\n');
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Trigger client navigation to the generated invoice mailto URL.
 *
 * @param invoice - Invoice details.
 * @param baseUrl - Optional application base URL.
 * @returns Mailto link string.
 */
function openInvoiceMailto(invoice, baseUrl) {
  const link = buildInvoiceMailto(invoice, baseUrl);
  if (typeof window !== 'undefined') {
    window.location.href = link;
  }
  return link;
}

/**
 * Trigger client navigation to the generated payment proof mailto URL.
 *
 * @param invoiceOrProof - Invoice or QuittanceProof details.
 * @param baseUrl - Optional application base URL.
 * @returns Mailto link string.
 */
function openProofMailto(invoiceOrProof, baseUrl, recipientOverride) {
  const link = buildProofMailto(invoiceOrProof, baseUrl, recipientOverride);
  if (typeof window !== 'undefined') {
    window.location.href = link;
  }
  return link;
}

module.exports = {
  isValidEmailFormat,
  resolvePayUrl,
  resolveInvoiceNetwork,
  canSendInvoiceEmail,
  getInvoiceMailtoRecipient,
  canSendProofEmail,
  getProofMailtoRecipient,
  buildInvoiceMailto,
  buildProofMailto,
  openInvoiceMailto,
  openProofMailto,
};
