// Fixture data shared by the memo prefix checker unit tests.

export interface PrefixCheckCase {
  name: string;
  memo: unknown;
  expectedResult: boolean;
}

export const PREFIX_CHECK_CASES: PrefixCheckCase[] = [
  {
    name: 'full invoice memo matches prefix',
    memo: 'INV-ABC123-XYZ789',
    expectedResult: true,
  },
  {
    name: 'prefix only matches',
    memo: 'INV-',
    expectedResult: true,
  },
  {
    name: 'empty string does not match',
    memo: '',
    expectedResult: false,
  },
  {
    name: 'null does not match',
    memo: null,
    expectedResult: false,
  },
  {
    name: 'undefined does not match',
    memo: undefined,
    expectedResult: false,
  },
  {
    name: 'number does not match',
    memo: 12345,
    expectedResult: false,
  },
  {
    name: 'boolean does not match',
    memo: true,
    expectedResult: false,
  },
  {
    name: 'object does not match',
    memo: { memo: 'INV-ABC' },
    expectedResult: false,
  },
  {
    name: 'array does not match',
    memo: ['INV-ABC'],
    expectedResult: false,
  },
  {
    name: 'lowercase prefix does not match',
    memo: 'inv-ABC123',
    expectedResult: false,
  },
  {
    name: 'prefix without trailing dash does not match',
    memo: 'INVABC',
    expectedResult: false,
  },
  {
    name: 'string shorter than prefix does not match',
    memo: 'IN',
    expectedResult: false,
  },
  {
    name: 'similar non-invoice prefix does not match',
    memo: 'INVOICE-ABC',
    expectedResult: false,
  },
];

export default { PREFIX_CHECK_CASES };
