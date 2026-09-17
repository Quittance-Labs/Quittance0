'use client';

import PayAmountBlock from '@/components/PayAmountBlock';
import PayMemoBlock from '@/components/PayMemoBlock';
import { memoPaymentHint } from '@/lib/pay-memo-hint';
import type { PayPageSession } from '@/components/pay-page.types';

interface PayDetailsSectionProps {
  session: PayPageSession;
}

/**
 * Details section presenting the amount, memo, and payment routing hints.
 */
export default function PayDetailsSection({ session }: PayDetailsSectionProps) {
  const { invoice, copy } = session;
  if (!invoice) return null;

  return (
    <div className="space-y-6">
      <PayAmountBlock invoice={invoice} />
      <PayMemoBlock
        invoice={invoice}
        onCopy={(value: string, label: string) => void copy(value, label)}
      />
      <p className="text-xs text-gray-600">
        {memoPaymentHint(invoice.memo)}
      </p>
    </div>
  );
}
