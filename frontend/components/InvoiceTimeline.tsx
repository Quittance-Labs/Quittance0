'use client';

import { Circle, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { formatAddress, formatDate } from '@/lib/utils';
import { buildInvoiceTimelineEvents } from '@/lib/invoice-timeline';
import { getTimeRemaining } from '@/lib/utils';
import { buildHorizonTxUrl, resolveExplorerNetwork } from '@/lib/explorer-tx-link';
import { getExplorerTransactionUrl } from '@/lib/stellar';
import { getLatePaymentTimelineCopy } from '@shared/settlement';

interface InvoiceTimelineInvoice {
  status?: string;
  createdAt?: string;
  expiresAt?: string;
  paidAt?: string;
  settledAt?: string;
  cancelledAt?: string;
  payerPublicKey?: string;
  paymentTxHash?: string;
  settlementContext?: 'ON_TIME' | 'AFTER_EXPIRY' | 'AFTER_CANCEL' | null;
  priorStatus?: string | null;
  latePaymentWarningCode?: 'PAYMENT_RECEIVED_AFTER_EXPIRY' | 'PAYMENT_RECEIVED_AFTER_CANCEL' | null;
  network?: string;
}

interface InvoiceTimelineProps {
  invoice: InvoiceTimelineInvoice;
  now?: number;
}


function iconFor(type: string) {
  switch (type) {
    case 'created':
      return <Circle className="w-5 h-5 text-gray-500" aria-hidden="true" />;
    case 'awaiting-payment':
      return <Clock className="w-5 h-5 text-yellow-700" aria-hidden="true" />;
    case 'expired':
      return <XCircle className="w-5 h-5 text-red-700" aria-hidden="true" />;
    case 'cancelled':
      return <XCircle className="w-5 h-5 text-gray-700" aria-hidden="true" />;
    case 'paid':
      return <CheckCircle2 className="w-5 h-5 text-green-700" aria-hidden="true" />;
    default:
      return <Circle className="w-5 h-5 text-gray-500" aria-hidden="true" />;
  }
}

/**
 * Chronological invoice event list for the seller invoice workspace
 * (issue #454). Event selection and ordering live in the pure
 * `buildInvoiceTimelineEvents` (lib/invoice-timeline.js) so that logic is
 * unit-tested independent of this rendering.
 */
export default function InvoiceTimeline({ invoice, now }: InvoiceTimelineProps) {
  const events = buildInvoiceTimelineEvents(invoice, now);

  return (
    <section className="card" aria-labelledby="invoice-timeline-heading">
      <h2 id="invoice-timeline-heading" className="text-lg font-semibold text-gray-900 mb-4">
        Timeline
      </h2>
      {/*
        An ordered list: these events happened in a specific sequence, which
        is exactly what <ol> communicates to assistive tech that a plain
        <div> stack would not.
      */}
      <ol className="space-y-4">
        {events.map((event, index) => (
          <li key={`${event.type}-${index}`} className="flex gap-3">
            <div className="flex-shrink-0 mt-0.5">{iconFor(event.type)}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">{event.label}</p>
              {event.timestamp && (
                <p className="text-xs text-gray-600">{formatDate(event.timestamp)}</p>
              )}
              {event.type === 'awaiting-payment' && event.deadline && (
                <p className="text-xs text-gray-600">
                  Expires in {getTimeRemaining(event.deadline)}
                </p>
              )}
              {event.type === 'paid' && (
                <div className="mt-1 space-y-1">
                  {event.payerPublicKey && (
                    <p className="text-xs text-gray-600 font-mono">
                      From {formatAddress(event.payerPublicKey)}
                    </p>
                  )}
                  {event.paymentTxHash && (
                    <a
                      /*
                        The explorer follows the invoice's network (issue
                        #431): a hardcoded 'public' sent a testnet seller to a
                        mainnet page that cannot show this transaction.
                      */
                      href={
                        buildHorizonTxUrl(
                          event.paymentTxHash,
                          resolveExplorerNetwork(invoice)
                        ) ?? getExplorerTransactionUrl(event.paymentTxHash)
                      }
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-cyan-700 hover:underline"
                    >
                      View transaction on Stellar Explorer
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  )}
                  {event.lateWarningCode && (
                    <p
                      role="alert"
                      className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 mt-1"
                    >
                      <AlertTriangle
                        className="w-3.5 h-3.5 flex-shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <span>{getLatePaymentTimelineCopy(event.lateWarningCode)}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
