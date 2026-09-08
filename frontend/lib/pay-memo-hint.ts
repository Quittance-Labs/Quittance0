// Pay page memo hint helper.
// Builds a contextual instruction line for the memo copy row on the pay page,
// reminding the payer that a memo is required and what it is for.

/**
 * Return a human-readable memo hint for the pay page.
 *
 * @param memo - The invoice memo.
 * @returns Localised memo hint text.
 */
export function memoPaymentHint(memo: unknown): string {
  const hasMemo = typeof memo === 'string' && memo.trim() !== '';
  if (!hasMemo) {
    return 'A memo is required so the seller can match your payment.';
  }

  const preview = memo.trim();
  const shortPreview = preview.length > 24 ? `${preview.slice(0, 24)}…` : preview;
  return `Copy this memo exactly: “${shortPreview}”`;
}
