/**
 * Drift guard for the shared verification contract (issue #377).
 *
 * The rejection codes and messages used to exist twice: authoritatively in
 * src/services/payment-verification.ts, and again as a hand-maintained mirror
 * in frontend/lib/verification.js whose own header instructed future editors
 * to keep the two identical. This test fails if the backend's public surface
 * ever diverges from shared/verification.ts, so a reintroduced local copy is
 * caught by the suite instead of reaching a pay screen.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  VERIFICATION_CHECKS,
  VERIFICATION_CODES,
  VERIFICATION_MESSAGES,
  messageForCode,
} from '../../shared/verification';
import {
  VERIFICATION_CODES as BACKEND_CODES,
  VERIFICATION_MESSAGES as BACKEND_MESSAGES,
  messageForCode as backendMessageForCode,
} from '../src/services/payment-verification';

describe('shared verification contract', () => {
  it('exposes the same rejection codes from the backend as from the shared module', () => {
    assert.deepEqual([...BACKEND_CODES].sort(), [...VERIFICATION_CODES].sort());
  });

  it('exposes the same message for every code', () => {
    assert.deepEqual(BACKEND_MESSAGES, VERIFICATION_MESSAGES);
  });

  it('resolves the same message through the backend helper for every code', () => {
    for (const code of VERIFICATION_CODES) {
      assert.equal(backendMessageForCode(code), messageForCode(code));
    }
  });

  it('keeps the four payment checks in their fixed order', () => {
    assert.deepEqual([...VERIFICATION_CHECKS], [
      'memo',
      'destination',
      'amount',
      'asset',
    ]);
  });

  it('has a message for every declared code, with no extras', () => {
    assert.deepEqual(
      Object.keys(VERIFICATION_MESSAGES).sort(),
      [...VERIFICATION_CODES].sort()
    );
  });
});
