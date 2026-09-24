'use client';

import ApiErrorState from '@/components/ApiErrorState';
import PaymentResultPanel from '@/components/PaymentResultPanel';
import type { PayPageSession } from '@/components/pay-page.types';

interface PayStatusHeroProps {
  session: PayPageSession;
}

/** Status hero: kicker, title, result panel, and trustline notice. */
export default function PayStatusHero({ session }: PayStatusHeroProps) {
  const { invoice, view, loadError, reload, payment } = session;
  if (!invoice) return null;

  return (
    <div>
      {loadError && (
        <div className="mb-6">
          <ApiErrorState message={loadError} onRetry={() => void reload()} compact />
        </div>
      )}

      <div className="text-center mb-10 sm:mb-12">
        <p className="pay-page-kicker">
          {view.expired
            ? 'Expired Invoice'
            : view.cancelled
              ? 'Cancelled Invoice'
              : 'Secure Payment'}
        </p>
        <h1 className="text-4xl sm:text-5xl font-bold text-[var(--ink)] mb-3">
          {view.expired
            ? 'Invoice Expired'
            : view.cancelled
              ? 'Invoice Cancelled'
              : 'Complete Payment'}
        </h1>
        <p className="text-xl text-[var(--muted)]">
          {view.expired
            ? 'Payment is no longer available'
            : view.cancelled
              ? 'This invoice was cancelled by the seller'
              : 'Pay with your Stellar wallet'}
        </p>
      </div>

      <div className="mb-6">
        <PaymentResultPanel state={payment} />
      </div>

      {invoice.assetCode && invoice.assetCode !== 'XLM' && view.showPaymentControls && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-900 flex items-start gap-3">
          <div>
            <span className="font-semibold block mb-0.5">{invoice.assetCode} Trustline Notice</span>
            <span>
              Please ensure your Stellar wallet has established a trustline for {invoice.assetCode} before submitting payment.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
