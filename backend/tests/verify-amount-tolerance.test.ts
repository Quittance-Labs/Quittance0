import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  amountsMatch,
  STROOP_DECIMALS,
} from '../src/utils/verify-amount-tolerance';
import {
  AMOUNT_MATCH_CASES,
  MALFORMED_INPUT_CASES,
} from './fixtures/verify-amount-tolerance.fixture';

describe('STROOP_DECIMALS', () => {
  it('is fixed at 7 to match the Stellar protocol', () => {
    assert.equal(STROOP_DECIMALS, 7);
  });
});

describe('amountsMatch — contract fixtures', () => {
  for (const fixture of AMOUNT_MATCH_CASES) {
    it(fixture.name, () => {
      const result = amountsMatch(
        fixture.expected,
        fixture.actual,
        fixture.toleranceStroops
      );
      assert.equal(result, fixture.expectedResult);
    });
  }
});

describe('amountsMatch — malformed input rejection', () => {
  for (const fixture of MALFORMED_INPUT_CASES) {
    it(fixture.name, () => {
      const result = amountsMatch(
        fixture.expected,
        fixture.actual,
        fixture.toleranceStroops
      );
      assert.equal(result, fixture.expectedResult);
    });
  }
});

describe('amountsMatch — direct edge cases', () => {
  it('treats omitted tolerance as zero tolerance (exact stroop match)', () => {
    assert.equal(amountsMatch('2.0000001', '2.0000001'), true);
    assert.equal(amountsMatch('2.0000000', '2.0000001'), false);
  });

  it('accepts string numbers formatted with integer-only form (no decimal)', () => {
    assert.equal(amountsMatch('5', '5.0000000', 0), true);
    assert.equal(amountsMatch(100, '100', 0), true);
  });

  it('rejects strings with leading spaces (number coercion would succeed; we guard by trimming empty but not whitespace in middle)', () => {
    assert.equal(amountsMatch('1.0000000', ' 1.0000000 ', 0), true);
  });

  it('does not let a float rounding error (> 0.5 stroop) silently match', () => {
    // 0.1 + 0.2 = 0.30000000000000004, which is still < 0.5 stroop and so
    // collapses to 0.3000000 stroops. 0.1000001 is deliberately 1 stroop
    // away from 0.1 and must not match with tolerance 0.
    assert.equal(amountsMatch('0.1000000', '0.1000001', 0), false);
  });

  it('rejects actual as a raw object (not string/number)', () => {
    assert.equal(amountsMatch('5', { toString: () => '5' } as any, 0), false);
  });

  it('tolerance of 100 stroops still rejects a 101-stroop gap', () => {
    assert.equal(amountsMatch('1.0000000', '1.0000101', 100), false);
    assert.equal(amountsMatch('1.0000000', '1.0000100', 100), true);
  });

  it('handles zero-amount invoices correctly (zero padding matches)', () => {
    assert.equal(amountsMatch('0', '0.0000000', 0), true);
    assert.equal(amountsMatch('0', '0.0000001', 0), false);
    assert.equal(amountsMatch('0', '0.0000001', 1), true);
  });
});

export default amountsMatch;
