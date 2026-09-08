// Shortened transaction hash formatter.
// Produces a compact display form of a Stellar transaction hash for UI lists
// and badges, without leaking private data.

const HASH_LENGTH = 64;

/**
 * Shorten a Stellar transaction hash for display.
 *
 * @param hash - 64-character hex transaction hash.
 * @param head - Number of leading characters to keep.
 * @param tail - Number of trailing characters to keep.
 * @returns Shortened hash or null when the hash is invalid.
 */
export function shortenTxHash(
  hash: unknown,
  head: number = 6,
  tail: number = 4
): string | null {
  if (typeof hash !== 'string') {
    return null;
  }

  const normalized = hash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    return null;
  }

  if (head < 1 || tail < 1 || head + tail > HASH_LENGTH) {
    return null;
  }

  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
}
