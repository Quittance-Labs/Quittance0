export type PayStateInput = string | { status?: string | null } | null | undefined;

/**
 * Terminal pay-UI statuses match the shared lifecycle machine: interactive
 * payment must not start or continue once the invoice is PAID, EXPIRED, or
 * CANCELLED. Late monitor/verify settlement may still move CANCELLED/EXPIRED
 * → PAID on the backend.
 */
const UI_TERMINAL_SET = new Set(['paid', 'expired', 'cancelled']);

/**
 * Checks whether a payment state or status string is terminal for the pay UI.
 */
export function isTerminalPayState(stateOrStatus?: PayStateInput): boolean {
  if (!stateOrStatus) return false;
  const status = typeof stateOrStatus === 'object'
    ? stateOrStatus.status
    : stateOrStatus;

  if (typeof status !== 'string') return false;
  return UI_TERMINAL_SET.has(status.trim().toLowerCase());
}
