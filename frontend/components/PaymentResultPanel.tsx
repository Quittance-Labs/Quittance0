'use client';

import { useEffect, useRef } from 'react';
import { CheckCircle, Clock, Loader2, XCircle } from 'lucide-react';
import {
  PAY_STATES,
  describePaymentState,
  isBusyState,
  isResultState,
  paymentStateKind,
  type PaymentState,
} from '@/lib/payment-page-state';
import { PAYMENT_RESULT_ID, announcementPoliteness, announcementRole } from '@/lib/a11y';

interface PaymentResultPanelProps {
  state: PaymentState;
  /** Rendered under the announcement — the receipt, the retry hint, and so on. */
  children?: React.ReactNode;
}

/**
 * The pay page's asynchronous result region (issue #289).
 *
 * Verification and background polling both resolve without a keyboard event, so
 * the payer's focus is still on the Verify button — or on nothing, after the
 * controls unmount — when the answer arrives. This panel does the two things
 * that fixes:
 *
 *  - it is a live region, so the answer is announced wherever focus happens to
 *    be, assertively for a failure and politely for anything else;
 *  - it takes focus once, on the transition into a result state, so the next
 *    Tab starts from the answer rather than from the top of the document.
 *
 * Focus is taken on the *transition* and not on every render, otherwise a
 * background poll landing while the payer is reading the receipt would yank
 * focus back out of whatever they had tabbed to.
 */
export default function PaymentResultPanel({ state, children }: PaymentResultPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const announcedResult = useRef(false);

  const message = describePaymentState(state);
  const busy = isBusyState(state);
  const isResult = isResultState(state);
  const kind = paymentStateKind(state);

  useEffect(() => {
    if (!isResult) {
      // Leaving the result states re-arms the panel for the next attempt.
      announcedResult.current = false;
      return;
    }

    if (announcedResult.current) return;
    announcedResult.current = true;
    panelRef.current?.focus();
  }, [isResult]);

  if (!message) return null;

  const icon = (() => {
    switch (state.status) {
      case PAY_STATES.PAID:
        return <CheckCircle className="w-6 h-6 text-green-700" aria-hidden="true" />;
      case PAY_STATES.EXPIRED:
      case PAY_STATES.ERROR:
        return <XCircle className="w-6 h-6 text-red-700" aria-hidden="true" />;
      case PAY_STATES.VERIFYING:
      case PAY_STATES.PAYING:
        return <Loader2 className="w-6 h-6 text-teal-800 animate-spin" aria-hidden="true" />;
      default:
        return <Clock className="w-6 h-6 text-gray-700" aria-hidden="true" />;
    }
  })();

  return (
    <div
      id={PAYMENT_RESULT_ID}
      ref={panelRef}
      // -1 keeps the panel out of the tab order but allows the focus() above.
      tabIndex={-1}
      role={announcementRole(kind)}
      aria-live={announcementPoliteness(kind)}
      aria-atomic="true"
      aria-busy={busy}
      className="card"
    >
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <p className="font-semibold text-gray-900">{message}</p>
          {children}
        </div>
      </div>
    </div>
  );
}
