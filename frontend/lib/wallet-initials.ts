// Wallet profile initials helper.
// Derives a short, deterministic set of initials from a Stellar public key for
// avatar placeholders and profile menus.

const FALLBACK_INITIALS = '??';

/**
 * Generate profile initials from a Stellar public key.
 *
 * Uses the first two alphanumeric characters after the leading 'G' so the
 * result is stable for a given wallet and safe to render in any avatar.
 *
 * @param publicKey - Stellar public key.
 * @returns One or two uppercase initials, or '??' for invalid input.
 */
export function initialsFromAddress(publicKey: unknown): string {
  if (typeof publicKey !== 'string') {
    return FALLBACK_INITIALS;
  }

  const trimmed = publicKey.trim();
  // Base32 alphabet used by Stellar public keys.
  if (!/^[G][A-Z2-7]{55}$/i.test(trimmed)) {
    return FALLBACK_INITIALS;
  }

  const chars = trimmed.slice(1).toUpperCase();
  return chars.slice(0, 2) || FALLBACK_INITIALS;
}
