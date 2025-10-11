'use client';

import { formatAmount, formatDate } from '@/lib/utils';
import { Check, Download, ExternalLink, Printer } from 'lucide-react';

interface PaymentReceiptProps {
  invoice: any;
}

export default function PaymentReceipt({ invoice }: PaymentReceiptProps) {
  const horizonUrl =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET'
      ? 'https://stellar.expert/explorer/testnet'
      : 'https://stellar.expert/explorer/public';

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    // Create receipt text
    const receiptText = `
═══════════════════════════════════════
          PAYMENT RECEIPT
═══════════════════════════════════════

Invoice ID: ${invoice.id}
Status: ${invoice.status}
Payment Date: ${formatDate(invoice.paidAt)}

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
Powered by Link to Pay
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

  return (
    <div className="card print:shadow-none" id="payment-receipt">
      {/* Header */}
      <div className="text-center mb-6 border-b pb-6">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
          <Check className="w-10 h-10 text-green-600" />
        </div>
        <h2 className="text-3xl font-bold text-gray-900 mb-2">Payment Receipt</h2>
        <p className="text-green-600 font-semibold text-lg">✓ Payment Confirmed</p>
      </div>

      {/* Invoice Details */}
      <div className="space-y-4 mb-6">
        <div className="bg-green-50 border-2 border-green-200 rounded-xl p-6 text-center">
          <p className="text-sm text-gray-600 mb-1">Amount Paid</p>
          <p className="text-4xl font-bold text-green-700">
            {formatAmount(invoice.amount, 7)}
          </p>
          <p className="text-xl font-semibold text-green-600 mt-1">{invoice.assetCode}</p>
        </div>

        {invoice.description && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-xs text-gray-600 mb-1">📝 Payment For</p>
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
            <p className="text-sm text-gray-900">{formatDate(invoice.paidAt)}</p>
          </div>
        </div>

        {(invoice.customerName || invoice.customerEmail) && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-2">
            <p className="text-sm text-gray-600 font-semibold">Customer Information</p>
            {invoice.customerName && (
              <div>
                <p className="text-xs text-gray-500">Name</p>
                <p className="text-sm text-gray-800">{invoice.customerName}</p>
              </div>
            )}
            {invoice.customerEmail && (
              <div>
                <p className="text-xs text-gray-500">Email</p>
                <p className="text-sm text-gray-800">{invoice.customerEmail}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Transaction Details */}
      <div className="border-t pt-6 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">🔗 Transaction Details</h3>
        
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

      {/* Actions */}
      <div className="border-t pt-6 space-y-3 print:hidden">
        <a
          href={`${horizonUrl}/tx/${invoice.paymentTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary w-full flex items-center justify-center gap-2"
        >
          <ExternalLink className="w-5 h-5" />
          View on Stellar Explorer
        </a>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handlePrint}
            className="btn btn-outline flex items-center justify-center gap-2"
          >
            <Printer className="w-4 h-4" />
            Print
          </button>

          <button
            onClick={handleDownload}
            className="btn btn-outline flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            Download
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center mt-6 pt-6 border-t">
        <p className="text-xs text-gray-500">
          This receipt confirms payment on the Stellar blockchain
        </p>
        <p className="text-xs text-gray-400 mt-1">
          Powered by Link to Pay
        </p>
      </div>
    </div>
  );
}

