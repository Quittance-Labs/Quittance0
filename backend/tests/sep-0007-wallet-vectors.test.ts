import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatQrPaymentPayload } from '../src/utils/qr-payment-payload';
import { SEP7_RESEARCH_VECTORS } from './fixtures/sep-0007-wallet.fixture';

describe('SEP-0007 wallet research vectors', () => {
  for (const vector of SEP7_RESEARCH_VECTORS) {
    it(vector.name, () => {
      assert.ok(vector.walletNote.length > 10);
      if (vector.current === 'accept') {
        assert.equal(formatQrPaymentPayload(vector.input).uri, vector.expectedUri);
        return;
      }

      if (vector.current === 'reject') {
        assert.throws(() => formatQrPaymentPayload(vector.input), {
          message: vector.expectedError,
        });
        return;
      }

      // Remaining gaps are deliberate — named in docs/SEP_0007_QR.md.
      assert.equal(vector.current, 'gap');
    });
  }

  it('keeps at least five accept/reject vectors and names every current gap', () => {
    assert.ok(SEP7_RESEARCH_VECTORS.length >= 5);
    assert.ok(SEP7_RESEARCH_VECTORS.some(vector => vector.recommendation === 'accept'));
    assert.ok(SEP7_RESEARCH_VECTORS.some(vector => vector.recommendation === 'reject'));
    for (const vector of SEP7_RESEARCH_VECTORS.filter(vector => vector.current === 'gap')) {
      assert.match(vector.walletNote, /current|formatter|explicit|validate/i);
    }
  });
});
