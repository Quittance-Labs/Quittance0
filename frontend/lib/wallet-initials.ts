/**
 * Derives deterministic 2-character initials from a Stellar public key or address.
 * Safely handles null, undefined, non-string, and malformed inputs by returning an empty string.
 *
 * @param publicKey - Stellar address or public key (e.g., 'GAP5YJST...')
 * @returns 2-character uppercase initials, or empty string if input is invalid
 */
export function initialsFromAddress(publicKey?: string | null): string {
  if (!publicKey || typeof publicKey !== 'string') {
    return '';
  }

  const cleaned = publicKey.trim().replace(/[^a-zA-Z0-9]/g, '');
  if (!cleaned) {
    return '';
  }

  return cleaned.slice(0, 2).toUpperCase();
}
