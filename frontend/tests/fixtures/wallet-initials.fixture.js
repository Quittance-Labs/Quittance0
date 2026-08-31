/**
 * Fixture data for wallet-initials tests.
 */

// A valid-looking Stellar public key (not a real account).
const SAMPLE_ADDRESS = 'GABCTEST123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Address whose payload starts with digits before any letters.
const DIGIT_LED_ADDRESS = 'G123ABC456DEF789GHIJKLMNOPQRSTUVWXYZ234567ABCDE';

// Empty / malformed inputs.
const EMPTY_ADDRESS = '';
const NULL_ADDRESS = null;
const NO_LETTER_ADDRESS = 'G1234567892345678923456789234567892345678923456';

module.exports = {
  SAMPLE_ADDRESS,
  DIGIT_LED_ADDRESS,
  EMPTY_ADDRESS,
  NULL_ADDRESS,
  NO_LETTER_ADDRESS,
};