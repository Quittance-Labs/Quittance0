'use client';

/**
 * `<StatusBadge>` — single source of truth for the invoice-status dot + label
 * that recurs across `pay/[id]/page.tsx` (3 inline blocks) and
 * `InvoiceCard.tsx` (header chip). Replaces the recurring `{status === … &&
 * (<><div/><span/></>)}` pattern. Pulls its meta from `STATUS_META` in
 * `@/lib/utils`, which is typed `Record<InvoiceStatus, …>` — adding a new
 * status surfaces at every call site via `tsc`.
 */

import type { Invoice } from '@/lib/utils';
import { STATUS_META } from '@/lib/utils';

interface StatusBadgeProps {
  invoice: Invoice;
}

export default function StatusBadge({ invoice }: StatusBadgeProps) {
  const meta = STATUS_META[invoice.status];
  return (
    <>
      <div className={meta.dotClassName} />
      <span className={meta.labelClassName}>{meta.label}</span>
    </>
  );
}
