import AssetLogo from './AssetLogo';
import PaymentStatus from './PaymentStatus';
import { formatAmount, formatDate, getTimeRemaining } from '@/lib/utils';
import type { PayPageInvoice } from './pay-page.types';

export default function PayAmountBlock({ invoice }: { invoice: PayPageInvoice }) {
  const expired = invoice.status === 'EXPIRED';
  return (
    <section aria-labelledby="payment-details-title" className="card">
      <h2 id="payment-details-title" className="text-3xl font-bold text-gray-900 mb-8">Payment Details</h2>
      <div className="space-y-5">
        <div className="pay-amount-panel">
          <p className="text-sm text-gray-600 mb-4 font-semibold uppercase tracking-wide">
            {expired ? 'Invoice Amount' : 'Amount to Pay'}
          </p>
          <div className="flex items-center justify-center gap-4">
            <AssetLogo code={invoice.assetCode} size={50} showName={false} />
            <div>
              <p className="text-5xl sm:text-6xl font-bold text-cyan-700">{formatAmount(invoice.amount, 7)}</p>
              <p className="text-xl font-bold text-cyan-600 mt-2">{invoice.assetCode}</p>
            </div>
          </div>
        </div>
        {invoice.description && <p className="pay-detail-panel"><span>Payment for</span>{invoice.description}</p>}
        {(invoice.sellerName || invoice.sellerEmail) && (
          <div className="pay-detail-panel">
            <span>Seller</span>
            {invoice.sellerName && <p>{invoice.sellerName}</p>}
            {invoice.sellerEmail && <p>{invoice.sellerEmail}</p>}
          </div>
        )}
        <PaymentStatus status={invoice.status} txHash={invoice.paymentTxHash ?? undefined} compact />
        {invoice.status === 'PENDING' && invoice.expiresAt && (
          <p className="pay-detail-panel"><span>Expires in</span>{getTimeRemaining(invoice.expiresAt)}</p>
        )}
        {invoice.status === 'PAID' && invoice.paidAt && (
          <p className="pay-detail-panel"><span>Payment completed</span>{formatDate(invoice.paidAt)}</p>
        )}
      </div>
    </section>
  );
}
