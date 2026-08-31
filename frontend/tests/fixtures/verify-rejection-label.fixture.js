// Fixture data for the rejection-label unit tests.
//
// Each known-code fixture pairs the VerificationCode with the expected short
// label, so a typo in any single label is caught by the table-driven suite
// instead of only the happy-path test. Unknown-code fixtures cover the
// fallback and default-unknown paths.

const KNOWN_CODE_FIXTURES = [
  { code: 'MISSING_TX_HASH', label: 'Transaction hash required' },
  { code: 'INVALID_TX_HASH', label: 'Invalid transaction hash' },
  { code: 'INVALID_PAYER_NAME', label: 'Invalid payer name' },
  { code: 'INVALID_PAYER_EMAIL', label: 'Invalid payer email' },
  { code: 'PAYER_INFO_TOO_LONG', label: 'Payer information too long' },
  { code: 'INVOICE_ALREADY_PAID', label: 'Invoice already paid' },
  { code: 'INVOICE_EXPIRED', label: 'Invoice expired' },
  { code: 'INVOICE_NOT_PENDING', label: 'Invoice not pending' },
  { code: 'TRANSACTION_NOT_FOUND', label: 'Transaction not found' },
  { code: 'NO_PAYMENT_OPERATION', label: 'No payment operation' },
  { code: 'MEMO_MISMATCH', label: 'Memo mismatch' },
  { code: 'DESTINATION_MISMATCH', label: 'Destination mismatch' },
  { code: 'AMOUNT_MISMATCH', label: 'Amount mismatch' },
  { code: 'ASSET_MISMATCH', label: 'Asset mismatch' },
  { code: 'NETWORK_MISMATCH', label: 'Network mismatch' },
];

const UNKNOWN_CODE_FIXTURES = [
  { name: 'an empty string code', code: '' },
  { name: 'a null code', code: null },
  { name: 'an undefined code', code: undefined },
  { name: 'a code the contract does not define', code: 'SOMETHING_UNDEFINED_1234' },
  { name: 'a blank/whitespace-only code', code: '   ' },
];

module.exports = {
  KNOWN_CODE_FIXTURES,
  UNKNOWN_CODE_FIXTURES,
};
