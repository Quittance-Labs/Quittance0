'use client';

import { CheckCircle, XCircle, Clock } from 'lucide-react';
import { statusText } from '@/lib/a11y';

interface PaymentStatusProps {
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  txHash?: string;
}

export default function PaymentStatus({ status, txHash }: PaymentStatusProps) {
  const getStatusIcon = () => {
    switch (status) {
      case 'PAID':
        return <CheckCircle className="w-16 h-16 text-green-700" aria-hidden="true" />;
      case 'EXPIRED':
        return <XCircle className="w-16 h-16 text-red-700" aria-hidden="true" />;
      case 'CANCELLED':
        return <XCircle className="w-16 h-16 text-gray-700" aria-hidden="true" />;
      default:
        return <Clock className="w-16 h-16 text-yellow-800" aria-hidden="true" />;
    }
  };

  /*
   * The heading and its colour used to be the only signal. Both the colour and
   * the icon are now decorative, and `statusText` supplies the wording so the
   * dashboard badge and the pay-page dot say exactly the same thing.
   *
   * Colours moved a step darker (green-600 to green-700, yellow-600 to
   * yellow-800) because the originals sat between 2.9:1 and 3.4:1 on white.
   */
  const getStatusMessage = () => {
    switch (status) {
      case 'PAID':
        return { title: 'Payment Successful!', color: 'text-green-700' };
      case 'EXPIRED':
        return { title: 'Invoice Expired', color: 'text-red-700' };
      case 'CANCELLED':
        return { title: 'Invoice Cancelled', color: 'text-gray-700' };
      default:
        return { title: 'Waiting for Payment', color: 'text-yellow-800' };
    }
  };

  const statusInfo = getStatusMessage();
  const { label, description } = statusText(status);
  const horizonUrl =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'TESTNET'
      ? 'https://stellar.expert/explorer/testnet'
      : 'https://stellar.expert/explorer/public';

  return (
    /*
     * A polite live region: this panel is re-rendered by the detail page's
     * background reload, so a status that changes while the page is open is
     * announced instead of silently swapping colour.
     */
    <div className="card text-center" role="status" aria-live="polite" aria-atomic="true">
      <div className="flex flex-col items-center gap-4">
        {getStatusIcon()}

        <div>
          <h2 className={`text-2xl font-bold ${statusInfo.color}`}>
            {statusInfo.title}
          </h2>
          <p className="text-gray-700 mt-2">{description}</p>
          {/* Text equivalent for the icon and colour, in the shared wording. */}
          <p className="sr-only">Invoice status: {label}.</p>
        </div>

        {txHash && (
          <a
            href={`${horizonUrl}/tx/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline mt-4"
          >
            View on Stellar Explorer
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </div>
    </div>
  );
}
