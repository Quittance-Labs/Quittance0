// Fixture data shared by the stroop-tolerance unit tests.
//
// Each fixture is a (expected, actual, tolerance, expectedResult) tuple.
// Names are kept descriptive so assertion messages read like a contract.

export interface AmountMatchCase {
  name: string;
  expected: string | number;
  actual: unknown;
  toleranceStroops: number;
  expectedResult: boolean;
}

const USDC_100_EXACT_STR = '100.0000000';
const XLM_50_NUM = 50;
const ONE_STROOP = 1;
const ZERO_STROOP = 0;
const TWO_STROOPS = 2;

export const AMOUNT_MATCH_CASES: AmountMatchCase[] = [
  {
    name: 'exact string match at zero tolerance',
    expected: USDC_100_EXACT_STR,
    actual: '100.0000000',
    toleranceStroops: ZERO_STROOP,
    expectedResult: true,
  },
  {
    name: 'exact numeric/string equivalence at zero tolerance',
    expected: XLM_50_NUM,
    actual: '50.0000000',
    toleranceStroops: ZERO_STROOP,
    expectedResult: true,
  },
  {
    name: 'actual one stroop below expected with zero tolerance mismatches',
    expected: '1.0000001',
    actual: '1.0000000',
    toleranceStroops: ZERO_STROOP,
    expectedResult: false,
  },
  {
    name: 'actual one stroop above expected with zero tolerance mismatches',
    expected: '1.0000000',
    actual: '1.0000001',
    toleranceStroops: ZERO_STROOP,
    expectedResult: false,
  },
  {
    name: 'actual one stroop below expected with tolerance of one matches',
    expected: '1.0000001',
    actual: '1.0000000',
    toleranceStroops: ONE_STROOP,
    expectedResult: true,
  },
  {
    name: 'actual one stroop above expected with tolerance of one matches',
    expected: '1.0000000',
    actual: '1.0000001',
    toleranceStroops: ONE_STROOP,
    expectedResult: true,
  },
  {
    name: 'actual two stroops above with tolerance of one mismatches',
    expected: '1.0000000',
    actual: '1.0000002',
    toleranceStroops: ONE_STROOP,
    expectedResult: false,
  },
  {
    name: 'actual two stroops below with tolerance of two matches',
    expected: '10.0000002',
    actual: '10.0000000',
    toleranceStroops: TWO_STROOPS,
    expectedResult: true,
  },
  {
    name: 'large credit-asset amount with rounding edge matches exactly',
    expected: '123456789.1234567',
    actual: '123456789.1234567',
    toleranceStroops: ZERO_STROOP,
    expectedResult: true,
  },
  {
    name: 'trivial float representation mismatch (< 0.5 stroop) collapses to zero-stroop match',
    expected: 0.3,
    actual: '0.3000000',
    toleranceStroops: ZERO_STROOP,
    expectedResult: true,
  },
  {
    name: 'actual exactly at tolerance boundary matches',
    expected: '7.0000000',
    actual: '7.0000003',
    toleranceStroops: 3,
    expectedResult: true,
  },
  {
    name: 'actual just over tolerance boundary mismatches',
    expected: '7.0000000',
    actual: '7.0000004',
    toleranceStroops: 3,
    expectedResult: false,
  },
];

export const MALFORMED_INPUT_CASES: AmountMatchCase[] = [
  {
    name: 'negative tolerance is rejected',
    expected: '5.0000000',
    actual: '5.0000000',
    toleranceStroops: -1,
    expectedResult: false,
  },
  {
    name: 'non-integer tolerance is rejected',
    expected: '5.0000000',
    actual: '5.0000000',
    toleranceStroops: 1.5,
    expectedResult: false,
  },
  {
    name: 'blank actual string is rejected',
    expected: '5.0000000',
    actual: '',
    toleranceStroops: ZERO_STROOP,
    expectedResult: false,
  },
  {
    name: 'null actual is rejected',
    expected: '5.0000000',
    actual: null,
    toleranceStroops: ZERO_STROOP,
    expectedResult: false,
  },
  {
    name: 'undefined actual is rejected',
    expected: '5.0000000',
    actual: undefined,
    toleranceStroops: ZERO_STROOP,
    expectedResult: false,
  },
  {
    name: 'non-numeric actual string is rejected',
    expected: '5.0000000',
    actual: 'notanumber',
    toleranceStroops: ZERO_STROOP,
    expectedResult: false,
  },
  {
    name: 'NaN actual is rejected',
    expected: '5.0000000',
    actual: NaN,
    toleranceStroops: ZERO_STROOP,
    expectedResult: false,
  },
  {
    name: 'Infinity actual is rejected',
    expected: '5.0000000',
    actual: Infinity,
    toleranceStroops: ZERO_STROOP,
    expectedResult: false,
  },
];

export default { AMOUNT_MATCH_CASES, MALFORMED_INPUT_CASES };
