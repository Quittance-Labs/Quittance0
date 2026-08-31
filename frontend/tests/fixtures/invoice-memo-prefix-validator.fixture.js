export const invoiceMemoPrefixValidatorFixture = [
  // Happy path
  {
    name: 'accepts exact default prefix',
    value: 'Q0-ABC123',
    options: undefined,
    expected: { valid: true, normalized: 'Q0-ABC123' },
  },
  {
    name: 'trims leading and trailing whitespace',
    value: '  Q0-ABC123  ',
    options: undefined,
    expected: { valid: true, normalized: 'Q0-ABC123' },
  },
  {
    name: 'accepts value at default max length',
    value: `Q0-${'A'.repeat(25)}`,
    options: undefined,
    expected: { valid: true, normalized: `Q0-${'A'.repeat(25)}` },
  },

  // Custom prefix
  {
    name: 'accepts custom prefix',
    value: 'INV-123',
    options: { prefix: 'INV-' },
    expected: { valid: true, normalized: 'INV-123' },
  },
  {
    name: 'rejects value missing custom prefix',
    value: 'Q0-ABC',
    options: { prefix: 'INV-' },
    expected: { valid: false, error: 'Memo must start with "INV-".' },
  },

  // Length edge cases
  {
    name: 'rejects value longer than default max length',
    value: `Q0-${'A'.repeat(26)}`,
    options: undefined,
    expected: { valid: false, error: 'Memo must be 28 characters or fewer.' },
  },
  {
    name: 'accepts value within custom max length',
    value: 'Q0-SHORT',
    options: { maxLength: 10 },
    expected: { valid: true, normalized: 'Q0-SHORT' },
  },
  {
    name: 'rejects value longer than custom max length',
    value: 'Q0-LONGVALUE',
    options: { maxLength: 10 },
    expected: { valid: false, error: 'Memo must be 10 characters or fewer.' },
  },
  {
    name: 'disables length check when maxLength is null',
    value: `Q0-${'A'.repeat(100)}`,
    options: { maxLength: null },
    expected: { valid: true, normalized: `Q0-${'A'.repeat(100)}` },
  },

  // Invalid inputs
  {
    name: 'rejects null',
    value: null,
    options: undefined,
    expected: { valid: false, error: 'Memo is required.' },
  },
  {
    name: 'rejects undefined',
    value: undefined,
    options: undefined,
    expected: { valid: false, error: 'Memo is required.' },
  },
  {
    name: 'rejects empty string',
    value: '',
    options: undefined,
    expected: { valid: false, error: 'Memo is required.' },
  },
  {
    name: 'rejects whitespace-only string',
    value: '   ',
    options: undefined,
    expected: { valid: false, error: 'Memo is required.' },
  },
  {
    name: 'rejects non-string number',
    value: 12345,
    options: undefined,
    expected: { valid: false, error: 'Memo must be a string.' },
  },
  {
    name: 'rejects non-string object',
    value: { memo: 'Q0-ABC' },
    options: undefined,
    expected: { valid: false, error: 'Memo must be a string.' },
  },

  // Prefix edge cases
  {
    name: 'rejects value without prefix',
    value: 'ABC123',
    options: undefined,
    expected: { valid: false, error: 'Memo must start with "Q0-".' },
  },
  {
    name: 'rejects prefix-only value',
    value: 'Q0-',
    options: undefined,
    expected: { valid: true, normalized: 'Q0-' },
  },
  {
    name: 'is case sensitive with default prefix',
    value: 'q0-abc',
    options: undefined,
    expected: { valid: false, error: 'Memo must start with "Q0-".' },
  },
];
