import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { redactPaymentEventData } from '../src/utils/payment-event-redaction';

describe('payment event redaction', () => {
  it('redacts identity keys in objects reached through nested arrays without mutating stored data', () => {
    const data = {
      code: 'PAYMENT_RECEIVED',
      attempts: [
        {
          txHash: 'tx-1',
          customerEmail: 'client@example.com',
          details: { payerName: 'Private name', amount: 4 },
        },
        [null, { memo: 'Private memo', assetCode: 'XLM' }],
      ],
      metadata: { customerName: 'Private client' },
    };
    const original = structuredClone(data);

    assert.deepEqual(redactPaymentEventData(data), {
      code: 'PAYMENT_RECEIVED',
      attempts: [
        { txHash: 'tx-1', details: { amount: 4 } },
        [null, { assetCode: 'XLM' }],
      ],
    });
    assert.deepEqual(data, original);
  });

  it('preserves scalar array values and rejects non-record event roots', () => {
    const data = { values: [null, false, 0, 'accepted', ['nested', 123]] };
    assert.deepEqual(redactPaymentEventData(data), data);
    assert.equal(redactPaymentEventData(null), null);
    assert.equal(redactPaymentEventData(undefined), null);
    assert.equal(redactPaymentEventData([] as unknown as Record<string, unknown>), null);
  });
});
