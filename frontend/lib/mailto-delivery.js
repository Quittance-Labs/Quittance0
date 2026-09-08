/**
 * Mailto delivery helpers for sending invoices and emailing payment proofs.
 * Pure logic shared across frontend components, export module, and test runner.
 */

const { assertPaymentProofAvailable, canExportPaymentProof } = require('./payment-proof-policy.js');

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

function buildProofMailto(invoice, baseUrl) {
  if (!invoice) {
    throw new Error('Invoice is required to build proof mailto link');
  }

  assertPaymentProofAvailable(invoice);

  const recipient = getProofMailtoRecipient(invoice);
  if (!recipient) {
    throw new Error('Client or payer email is required to email payment proof');
  }

  const shortId = (invoice.id || '').substring(0, 8).toUpperCase();
  const subject = `Payment Proof - Invoice #${shortId} - ${invoice.amount} ${invoice.assetCode || 'XLM'}`;
  const payUrl = resolvePayUrl(invoice.id, baseUrl);

  const lines = [
    'Payment Proof Details:',
    `Invoice ID: ${invoice.id}`,
    `Amount Paid: ${invoice.amount} ${invoice.assetCode || 'XLM'}`,
    'Status: PAID',
  ];

  if (invoice.paidAt) {
    lines.push(`Payment Date: ${formatDateDisplay(invoice.paidAt)}`);
  }
  if (invoice.paymentTxHash) {
    lines.push(`Transaction Hash: ${invoice.paymentTxHash}`);
  }
  if (invoice.sellerPublicKey) {
    lines.push(`Seller Address: ${invoice.sellerPublicKey}`);
  }
  if (invoice.payerPublicKey) {
    lines.push(`Payer Address: ${invoice.payerPublicKey}`);
  }
  if (invoice.customerName) {
    lines.push(`Client Name: ${invoice.customerName}`);
  }
  if (invoice.payerName) {
    lines.push(`Payer Name: ${invoice.payerName}`);
  }
  if (invoice.memo) {
    lines.push(`Memo: ${invoice.memo}`);
  }

  lines.push('');
  lines.push(`View Proof / Payment Details: ${payUrl}`);
  lines.push('Verified on Stellar Blockchain');
  lines.push('');
  lines.push('Powered by Quittance');

  const body = lines.join('\n');
  return `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function openInvoiceMailto(invoice, baseUrl) {
  const link = buildInvoiceMailto(invoice, baseUrl);
  if (typeof window !== 'undefined') {
    window.location.href = link;
  }
  return link;
}

function openProofMailto(invoice, baseUrl) {
  const link = buildProofMailto(invoice, baseUrl);
  if (typeof window !== 'undefined') {
    window.location.href = link;
  }
  return link;
}

module.exports = {
  isValidEmailFormat,
  resolvePayUrl,
  canSendInvoiceEmail,
  getInvoiceMailtoRecipient,
  canSendProofEmail,
  getProofMailtoRecipient,
  buildInvoiceMailto,
  buildProofMailto,
  openInvoiceMailto,
  openProofMailto,
};
