/**
 * Extract deterministic uppercase initials from a Stellar public key.
 *
 * Stellar ed25519 public keys start with 'G' and are base32-encoded using
 * characters A-Z and 2-7. We skip the leading 'G' and take the first two
 * alphabetic characters so the result is readable and deterministic.
 *
 * @param {string} publicKey
 * @returns {string}
 */
function initialsFromAddress(publicKey) {
  if (!publicKey || typeof publicKey !== 'string') {
    return '??';
  }

  // Remove the leading 'G' network prefix.
  const payload = publicKey.startsWith('G') ? publicKey.slice(1) : publicKey;

  // Grab the first two alphabetic characters from the payload.
  const letters = payload.match(/[A-Z]/g);
  if (!letters || letters.length === 0) {
    return '??';
  }

  const first = letters[0];
  const second = letters.length > 1 ? letters[1] : first;

  return `${first}${second}`;
}

module.exports = { initialsFromAddress };
