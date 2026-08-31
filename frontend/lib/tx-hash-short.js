// Shortened transaction hash formatter.
//
// Produces a compact display form of a Stellar transaction hash for UI lists
// and badges, without leaking private data.

const HASH_LENGTH = 64;

/**
 * Shorten a Stellar transaction hash for display.
 *
 * @param {string | undefined | null} txHash - 64-character hex transaction hash.
 * @param {number} [head=6] - Number of leading characters to keep.
 * @param {number} [tail=4] - Number of trailing characters to keep.
 * @returns {string | null} Shortened hash or null when the hash is invalid.
 */
function formatShortTxHash(txHash, head = 6, tail = 4) {
  if (!txHash || typeof txHash !== 'string') {
    return null;
  }

  const normalized = txHash.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    return null;
  }

  if (head < 1 || tail < 1 || head + tail > HASH_LENGTH) {
    return null;
  }

  return `${normalized.slice(0, head)}...${normalized.slice(-tail)}`;
}

module.exports = { formatShortTxHash };
