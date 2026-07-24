'use client';

/**
 * `<StatusBadge>` — single source of truth for BOTH invoice-status
 * rendering variants:
 *   - `variant="badge"` (default) — dot + friendly label fragment used
 *     by `pay/[id]/page.tsx`'s header. Renders as `<>{<div dot/>}{<span label/>}</>`.
 *   - `variant="chip"` — bg+text-color pill used by
 *     `components/InvoiceCard.tsx`'s header chip. Renders as a single
 *     `<span>...{meta.chipLabel}</span>` with the chip-specific
 *     wrapper classes attached.
 *
 * Both variants pull their meta from the typed `STATUS_META` lookup
 * (`Record<InvoiceStatus, …>`) in `@/lib/utils`. Adding a new status
 * surfaces at every `<StatusBadge>` call site via `tsc`.
 */

import type { Invoice } from '@/lib/utils';
import { STATUS_META } from '@/lib/utils';

interface StatusBadgeProps {
  invoice: Invoice;
  variant?: 'badge' | 'chip';
}

export default function StatusBadge({ invoice, variant = 'badge' }: StatusBadgeProps) {
  const meta = STATUS_META[invoice.status];

  if (variant === 'chip') {
    // Render `{invoice.status}` directly rather than a redundant
    // `meta.chipLabel` field — every `STATUS_META.<key>.chipLabel`
    // would be byte-identical to the lookup key, and the typed
    // `InvoiceStatus` union guarantees the value is uppercase string.
    return (
      <span className={`px-3 py-1 rounded-lg text-xs font-semibold ${meta.chipClassName}`}>
        {invoice.status}
      </span>
    );
  }

  return (
    <>
      <div className={meta.dotClassName} />
      <span className={meta.labelClassName}>{meta.label}</span>
    </>
  );
}
