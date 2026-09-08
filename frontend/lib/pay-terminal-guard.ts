export type PayStateInput = string | { status?: string | null } | null | undefined;

const TERMINAL_SET = new Set(['paid', 'expired', 'cancelled']);

/**
 * Checks whether a payment state or status string is terminal.
 * Terminal states (paid, expired, cancelled) cannot transition to intermediate states.
 */
export function isTerminalPayState(stateOrStatus?: PayStateInput): boolean {
  if (!stateOrStatus) return false;
  const status = typeof stateOrStatus === 'object'
    ? stateOrStatus.status
    : stateOrStatus;

  if (typeof status !== 'string') return false;
  return TERMINAL_SET.has(status.trim().toLowerCase());
}
