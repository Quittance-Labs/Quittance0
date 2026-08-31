// Freighter install prompt message helper.
// Builds a contextual, human-readable message when the Freighter extension is
// not installed, so every call-to-action uses the same copy.

export const FREIGHTER_APP_URL = 'https://www.freighter.app/';

const MESSAGES: Record<string, string> = Object.freeze({
  default:
    'You need the Freighter browser extension before you can continue. Install it from',
  pay:
    'You need the Freighter browser extension before you can pay. Install it from',
  create:
    'You need the Freighter browser extension before you can create an invoice. Install it from',
});

/**
 * Return the standard Freighter install prompt message.
 *
 * @param variant - Optional context variant ('pay', 'create', or 'default').
 * @returns Localised install prompt message (without the link markup).
 */
export function freighterInstallMessage(variant: unknown = 'default'): string {
  const key = typeof variant === 'string' ? variant.trim().toLowerCase() : 'default';
  return MESSAGES[key] ?? MESSAGES.default;
}
