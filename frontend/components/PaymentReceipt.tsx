'use client';

import { formatAmount, formatDate } from '@/lib/utils';
import { describeAmount } from '@/lib/a11y';
import { Check, Download, ExternalLink, FileText, Mail } from 'lucide-react';
import AssetLogo from './AssetLogo';
import { openInvoicePDF, shareInvoiceByEmail } from '@/lib/export';
import { toast } from 'sonner';
import type { PayPageInvoice } from './pay-page.types';
import { getExplorerTransactionUrl } from '@/lib/stellar';

interface PaymentReceiptProps {
  invoice: PayPageInvoice;
}

export default function PaymentReceipt({ invoice }: PaymentReceiptProps) {
  const handleDownloadPDF = () => {
    openInvoicePDF(invoice as any);
    toast.success('Opening payment proof');
  };

  const handleEmailProof = () => {
    if (!invoice.customerEmail) {
      toast.error('No client email on this invoice');
      return;
    }
    shareInvoiceByEmail(invoice as any);
  };

  const handleDownload = () => {
    const receiptText = `
═══════════════════════════════════════
          PAYMENT RECEIPT
═══════════════════════════════════════

Invoice ID: ${invoice.id}
Status: ${invoice.status}
Payment Date: ${formatDate(invoice.paidAt || invoice.createdAt)}

───────────────────────────────────────
PAYMENT DETAILS
───────────────────────────────────────

Amount Paid: ${formatAmount(invoice.amount, 7)} ${invoice.assetCode}
${invoice.description ? `Description: ${invoice.description}` : ''}
${invoice.customerName ? `Customer: ${invoice.customerName}` : ''}
${invoice.customerEmail ? `Email: ${invoice.customerEmail}` : ''}

───────────────────────────────────────
TRANSACTION DETAILS
───────────────────────────────────────

Transaction Hash:
${invoice.paymentTxHash}

From (Payer):
${invoice.payerPublicKey || 'N/A'}

To (Recipient):
${invoice.sellerPublicKey}

Memo: ${invoice.memo}

───────────────────────────────────────
Powered by Quittance
Stellar Blockchain Payment System
═══════════════════════════════════════
    `.trim();

    const blob = new Blob([receiptText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${invoice.id}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const activeAssetCode = invoice.assetCode || 'XLM';
  const amountLabel = describeAmount(formatAmount(invoice.amount, 7), activeAssetCode);
  const canEmail = Boolean(invoice.customerEmail);
  const emailReasonId = 'receipt-email-reason';

  return (
    /*
     * The receipt is a named region so it can be reached directly, and it is
     * what the pay page moves focus to once a payment is confirmed.
     */
    <section
      className="card print:shadow-none"
      id="payment-receipt"
      aria-labelledby="payment-receipt-heading"
    >
      <div className="text-center mb-6 border-b pb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          <Check className="w-10 h-10 text-green-700" aria-hidden="true" />
        </div>
        <h2 id="payment-receipt-heading" className="text-3xl font-bold text-gray-900 mb-2">
          Payment Receipt
        </h2>
        <p className="text-green-700 font-semibold text-lg">Payment Confirmed</p>
      </div>

      <div className="space-y-4 mb-6">
        {/*
          The figure and the asset code are two separate elements, which a
          screen reader reads as two unrelated numbers. One accessible name on
          the group fixes that; the pieces inside are hidden to avoid the echo.
        */}
        <div className="bg-gradient-to-br from-green-50 to-green-100 border-2 border-green-200 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-600 mb-3" aria-hidden="true">
            Amount Paid
          </p>
          <div
            className="flex items-center justify-center gap-3"
            role="group"
            aria-label={`Amount paid: ${amountLabel}`}
          >
            <AssetLogo code={invoice.assetCode} size={36} showName={false} decorative />
            <div aria-hidden="true">
              <p className="text-4xl font-bold text-green-700">
                {formatAmount(invoice.amount, 7)}
              </p>
              <p className="text-lg font-semibold text-green-700 mt-1">
                {invoice.assetCode}
              </p>
            </div>
          </div>
        </div>

        {invoice.description && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs text-gray-600 mb-1">Payment For</p>
            <p className="text-gray-800 font-medium">{invoice.description}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-600 mb-1">Invoice ID</p>
            <p className="text-sm font-mono text-gray-900 break-all">{invoice.id}</p>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-600 mb-1">Payment Date</p>
            <p className="text-sm text-gray-900">{formatDate(invoice.paidAt || invoice.createdAt)}</p>
          </div>
        </div>

        {(invoice.sellerName || invoice.sellerEmail) && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
            <p className="text-sm text-blue-700 font-semibold">Seller Information</p>
            {invoice.sellerName && (
              <div>
                <p className="text-xs text-blue-700">Name</p>
                <p className="text-sm text-blue-800">{invoice.sellerName}</p>
              </div>
            )}
            {invoice.sellerEmail && (
              <div>
                <p className="text-xs text-blue-700">Email</p>
                <p className="text-sm text-blue-800">{invoice.sellerEmail}</p>
              </div>
            )}
          </div>
        )}

        {invoice.sellerName && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
            <p className="text-sm text-blue-700 font-semibold">Paid to</p>
            <p className="text-lg font-bold text-blue-800">{invoice.sellerName}</p>
            {invoice.sellerEmail && (
              <p className="text-sm text-blue-700">{invoice.sellerEmail}</p>
            )}
          </div>
        )}

        {(invoice.payerName || invoice.payerEmail) && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <p className="text-sm text-green-700 font-semibold">Paid by</p>
            {invoice.payerName && (
              <p className="text-lg font-bold text-green-800">{invoice.payerName}</p>
            )}
            {invoice.payerEmail && (
              <p className="text-sm text-green-700">{invoice.payerEmail}</p>
            )}
          </div>
        )}
      </div>

      <div className="border-t pt-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Transaction Details</h3>
        
        <div className="space-y-3">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-600 mb-1">Transaction Hash</p>
            <p className="text-xs font-mono text-gray-900 break-all">{invoice.paymentTxHash}</p>
          </div>

          {invoice.payerPublicKey && (
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-600 mb-1">From (Payer Address)</p>
              <p className="text-xs font-mono text-gray-900 break-all">{invoice.payerPublicKey}</p>
            </div>
          )}

          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-600 mb-1">To (Recipient Address)</p>
            <p className="text-xs font-mono text-gray-900 break-all">{invoice.sellerPublicKey}</p>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-xs text-gray-600 mb-1">Memo</p>
            <p className="text-sm font-mono text-gray-900">{invoice.memo}</p>
          </div>
        </div>
      </div>

      <div className="border-t pt-6 space-y-3 print:hidden">
        <button
          onClick={handleDownloadPDF}
          className="btn btn-primary w-full flex items-center justify-center gap-2"
        >
          <FileText className="w-5 h-5" aria-hidden="true" />
          Download Proof
        </button>

        {/*
          `aria-disabled` keeps this focusable so the reason below is announced.
          Under `disabled` it was skipped by the tab order entirely and the
          `title` explaining why was never read out.
        */}
        <button
          onClick={canEmail ? handleEmailProof : undefined}
          aria-disabled={!canEmail}
          aria-describedby={canEmail ? undefined : emailReasonId}
          className="btn btn-secondary w-full flex items-center justify-center gap-2"
        >
          <Mail className="w-5 h-5" aria-hidden="true" />
          Email Proof
        </button>
        {!canEmail && (
          <p id={emailReasonId} className="field-hint text-center">
            Unavailable: this invoice has no client email.
          </p>
        )}

        <a
          href={getExplorerTransactionUrl(invoice.paymentTxHash || '')}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-outline w-full flex items-center justify-center gap-2"
        >
          <ExternalLink className="w-5 h-5" aria-hidden="true" />
          View on Stellar Explorer
          <span className="sr-only"> (opens in a new tab)</span>
        </a>

        <button
          onClick={handleDownload}
          className="btn btn-outline w-full flex items-center justify-center gap-2 text-sm"
        >
          <Download className="w-4 h-4" aria-hidden="true" />
          Download TXT receipt
        </button>
      </div>

      <div className="text-center mt-6 pt-6 border-t">
        <p className="text-xs text-gray-600">
          This receipt confirms payment on the Stellar blockchain
        </p>
        <p className="text-xs text-gray-600 mt-1">
          Powered by Quittance
        </p>
      </div>
    </section>
  );
}
