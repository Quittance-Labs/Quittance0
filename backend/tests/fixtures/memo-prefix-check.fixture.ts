// Fixture data for invoice memo prefix validation tests (issue #272).

export interface MemoPrefixTestCase {
  name: string;
  memo: unknown;
  expectedResult: boolean;
}

export const VALID_MEMO_PREFIX_CASES: MemoPrefixTestCase[] = [
  {
    name: 'standard generated invoice memo format',
    memo: 'INV-12345-ABCDE',
    expectedResult: true,
  },
  {
    name: 'exact invoice prefix alone',
    memo: 'INV-',
    expectedResult: true,
  },
  {
    name: 'invoice prefix with numeric identifier',
    memo: 'INV-100',
    expectedResult: true,
  },
  {
    name: 'invoice prefix with demo string suffix',
    memo: 'INV-DEMO-001',
    expectedResult: true,
  },
  {
    name: 'invoice prefix with alphanumeric uppercase string',
    memo: 'INV-M0X9A8Z7-K1L2M3N4',
    expectedResult: true,
  },
  {
    name: 'invoice prefix with lowercase suffix',
    memo: 'INV-test-suffix',
    expectedResult: true,
  },
  {
    name: 'invoice prefix with special characters suffix',
    memo: 'INV-!@#$%^&*()',
    expectedResult: true,
  },
];

export const INVALID_MEMO_PREFIX_CASES: MemoPrefixTestCase[] = [
  {
    name: 'lowercase prefix is rejected (case-sensitive requirement)',
    memo: 'inv-12345-ABCDE',
    expectedResult: false,
  },
  {
    name: 'mixed case prefix is rejected',
    memo: 'Inv-12345-ABCDE',
    expectedResult: false,
  },
  {
    name: 'missing hyphen after INV is rejected',
    memo: 'INV12345',
    expectedResult: false,
  },
  {
    name: 'prefix appearing in the middle of memo is rejected',
    memo: 'ORDER-INV-123',
    expectedResult: false,
  },
  {
    name: 'prefix with leading whitespace is rejected',
    memo: ' INV-12345',
    expectedResult: false,
  },
  {
    name: 'prefix appearing at the end is rejected',
    memo: '12345-INV-',
    expectedResult: false,
  },
  {
    name: 'completely different prefix is rejected',
    memo: 'PAY-12345-ABCDE',
    expectedResult: false,
  },
  {
    name: 'empty string is rejected',
    memo: '',
    expectedResult: false,
  },
  {
    name: 'whitespace only string is rejected',
    memo: '   ',
    expectedResult: false,
  },
  {
    name: 'null value is rejected',
    memo: null,
    expectedResult: false,
  },
  {
    name: 'undefined value is rejected',
    memo: undefined,
    expectedResult: false,
  },
  {
    name: 'number is rejected',
    memo: 12345,
    expectedResult: false,
  },
  {
    name: 'boolean is rejected',
    memo: true,
    expectedResult: false,
  },
  {
    name: 'object is rejected',
    memo: { memo: 'INV-123' },
    expectedResult: false,
  },
  {
    name: 'array is rejected',
    memo: ['INV-123'],
    expectedResult: false,
  },
  {
    name: 'Symbol is rejected',
    memo: Symbol('INV-123'),
    expectedResult: false,
  },
];

export default {
  VALID_MEMO_PREFIX_CASES,
  INVALID_MEMO_PREFIX_CASES,
};
