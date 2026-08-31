// Pay page memo hint helper.
//
// Builds a contextual instruction line for the memo copy row on the pay page,
// reminding the payer when a memo is required and what it is for.

/**
 * Return a human-readable memo hint for the pay page.
 *
 * @param {string | undefined | null} memo - The invoice memo.
 * @param {boolean} [required=true] - Whether the memo is required for payment.
 * @returns {string} Localised memo hint text.
 */
function payMemoHint(memo, required = true) {
  const hasMemo = memo && typeof memo === 'string' && memo.trim() !== '';
  if (!hasMemo) {
    return required
      ? 'A memo is required so the seller can match your payment.'
      : 'No memo is needed for this payment.';
  }

  const preview = memo.trim();
  const shortPreview = preview.length > 24 ? `${preview.slice(0, 24)}…` : preview;
  return required
    ? `Copy this memo exactly: “${shortPreview}”`
    : `Optional memo: “${shortPreview}”`;
}

module.exports = { payMemoHint };
