import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatQrPaymentPayload } from '../src/utils/qr-payment-payload';
import {
  VALID_DESTINATION,
  VALID_ASSET_ISSUER,
  VALID_CASES,
  ERROR_CASES,
} from './fixtures/qr-payment-payload.fixture';

describe('formatQrPaymentPayload — valid fixtures', () => {
  for (const c of VALID_CASES) {
    it(c.name, () => {
      const result = formatQrPaymentPayload(c.input);
      assert.equal(result.uri, c.expected.uri);
      assert.deepEqual(result.params, c.expected.params);
    });
  }
});

describe('formatQrPaymentPayload — error fixtures', () => {
  for (const c of ERROR_CASES) {
    it(c.name, () => {
      assert.throws(() => formatQrPaymentPayload(c.input), {
        message: c.expectedError,
      });
    });
  }
});

describe('formatQrPaymentPayload — direct edge cases', () => {
  it('omits memo when it is undefined', () => {
    const result = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '1',
    });
    assert.equal('memo' in result.params, false);
    assert.equal('memo_type' in result.params, false);
  });

  it('omits memo when it is an empty string', () => {
    const result = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '1',
      memo: '',
    });
    assert.equal('memo' in result.params, false);
    assert.equal('memo_type' in result.params, false);
  });

  it('encodes special characters in memo', () => {
    const result = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '1',
      memo: 'hello world & tips',
    });
    assert.ok(result.uri.includes('hello%20world%20%26%20tips'));
    assert.equal(result.params.memo, 'hello world & tips');
  });

  it('defaults to XLM when no asset is provided', () => {
    const result = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '1',
    });
    assert.equal('asset_code' in result.params, false);
    assert.equal('asset_issuer' in result.params, false);
  });

  it('does not include asset_code or asset_issuer for native XLM', () => {
    const result = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '1',
      asset: { code: 'XLM' },
    });
    assert.equal('asset_code' in result.params, false);
    assert.equal('asset_issuer' in result.params, false);
  });

  it('ignores issuer when asset code is native XLM', () => {
    const result = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '1',
      asset: { code: 'XLM', issuer: VALID_ASSET_ISSUER },
    });
    assert.equal('asset_code' in result.params, false);
    assert.equal('asset_issuer' in result.params, false);
  });
});
