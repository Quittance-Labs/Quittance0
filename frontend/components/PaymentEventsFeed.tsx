'use client';

import { useEffect, useState } from 'react';
import { invoiceApi } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface PaymentEvent {
  id: string;
  eventType: string;
  eventData?: {
    code?: string;
    txHash?: string;
    source?: string;
    balanceId?: string;
    amount?: string;
    asset?: string;
    predicate?: unknown;
  } | null;
  createdAt: string;
}

const EVENT_LABELS: Record<string, string> = {
  PAYMENT_CONFIRMED: 'Payment confirmed',
  PAYMENT_REJECTED: 'Payment rejected',
  PARTIAL_PAYMENT: 'Partial payment received',
  CLAIMABLE_BALANCE_RECEIVED: 'Claimable balance received',
};

/**
 * Seller-side audit feed for one invoice (issue #515). Rejected verifies and
 * monitor rejections are listed so "why is this still PENDING" answers itself.
 * Rendered only for the owning wallet — the endpoint refuses anyone else.
 */
export default function PaymentEventsFeed({
  invoiceId,
  sellerPublicKey,
}: {
  invoiceId: string;
  sellerPublicKey: string;
}) {
  const [events, setEvents] = useState<PaymentEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoiceApi
      .getPaymentEvents(invoiceId, sellerPublicKey)
      .then((res) => {
        if (!cancelled) setEvents(Array.isArray(res?.data) ? res.data : []);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, sellerPublicKey]);

  if (!events || events.length === 0) return null;

  return (
    <section aria-labelledby="payment-events-heading" className="mt-6 sm:mt-8">
      <div className="card">
        <h2 id="payment-events-heading" className="text-lg font-semibold text-gray-900 mb-4">
          Payment activity
        </h2>
        <ul className="divide-y divide-gray-100">
          {events.map((event) => (
            <li key={event.id} className="py-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {EVENT_LABELS[event.eventType] ?? event.eventType}
                </p>
                {event.eventType === 'CLAIMABLE_BALANCE_RECEIVED' && (
                  <div className="mt-1 text-xs text-amber-800">
                    {event.eventData?.amount && event.eventData?.asset && (
                      <p className="break-all">
                        {event.eventData.amount} {event.eventData.asset === 'native' ? 'XLM' : event.eventData.asset}
                      </p>
                    )}
                    {event.eventData?.balanceId && (
                      <p className="font-mono break-all">Balance {event.eventData.balanceId}</p>
                    )}
                    <p className="mt-1">
                      Claim this balance in a compatible Stellar wallet when its claim conditions allow.
                      The invoice remains pending until a qualifying payment is verified.
                    </p>
                  </div>
                )}
                {event.eventData?.code && (
                  <p className="text-xs text-gray-500 font-mono mt-0.5">{event.eventData.code}</p>
                )}
                {event.eventData?.txHash && (
                  <p className="text-xs text-gray-400 font-mono mt-0.5 break-all">
                    tx {event.eventData.txHash.slice(0, 16)}…
                  </p>
                )}
              </div>
              <time className="text-xs text-gray-500 whitespace-nowrap">
                {formatDate(event.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
