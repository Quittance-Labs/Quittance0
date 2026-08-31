/**
 * Fixture data for invoice-status-label tests.
 */

const VALID_CASES = [
  { status: 'PENDING', expected: 'Pending' },
  { status: 'PAID', expected: 'Paid' },
  { status: 'EXPIRED', expected: 'Expired' },
  { status: 'CANCELLED', expected: 'Cancelled' },
];

const INVALID_CASES = [
  { status: 'DRAFT', expected: 'Unknown' },
  { status: '', expected: 'Unknown' },
  { status: null, expected: 'Unknown' },
];

module.exports = {
  VALID_CASES,
  INVALID_CASES,
};
