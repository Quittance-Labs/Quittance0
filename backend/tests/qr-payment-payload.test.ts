import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatQrPaymentPayload,
} from '../src/utils/qr-payment-payload';
import {
  resolveInvoiceAsset,
  resolvePaymentAsset,
} from '../src/utils/asset-helpers';
import {
  QR_PAYMENT_PAYLOAD_FIXTURES,
  QR_PAYMENT_PAYLOAD_ERROR_FIXTURES,
} from './fixtures/qr-payment-payload.fixture';

const DESTINATION_A = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ISSUER_USDC = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

describe('formatQrPaymentPayload — contract fixtures', () => {
  for (const fixture of QR_PAYMENT_PAYLOAD_FIXTURES) {
    it(fixture.name, () => {
      const result = formatQrPaymentPayload(fixture.input);
      assert.equal(result, fixture.expectedResult);
    });
  }
});

describe('formatQrPaymentPayload — error validation', () => {
  for (const fixture of QR_PAYMENT_PAYLOAD_ERROR_FIXTURES) {
    it(fixture.name, () => {
      assert.throws(
        () => formatQrPaymentPayload(fixture.input),
        (err: Error) => {
          assert.equal(err.message, fixture.expectedErrorMessage);
          return true;
        }
      );
    });
  }
});

describe('formatQrPaymentPayload — direct edge cases', () => {
  it('handles asset resolved via resolveInvoiceAsset (native)', () => {
    const nativeAsset = resolveInvoiceAsset({ assetCode: 'XLM' });
    const uri = formatQrPaymentPayload({
      destination: DESTINATION_A,
      amount: '50.0000000',
      asset: nativeAsset,
    });
    assert.equal(uri, `web+stellar:pay?destination=${DESTINATION_A}&amount=50.0000000`);
  });

  it('handles asset resolved via resolveInvoiceAsset (credit)', () => {
    const creditAsset = resolveInvoiceAsset({ assetCode: 'USDC', assetIssuer: ISSUER_USDC });
    const uri = formatQrPaymentPayload({
      destination: DESTINATION_A,
      amount: '50.0000000',
      asset: creditAsset,
    });
    assert.equal(
      uri,
      `web+stellar:pay?destination=${DESTINATION_A}&amount=50.0000000&asset_code=USDC&asset_issuer=${ISSUER_USDC}`
    );
  });

  it('handles asset resolved via resolvePaymentAsset (credit)', () => {
    const creditAsset = resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'USDC',
      assetIssuer: ISSUER_USDC,
    });
    const uri = formatQrPaymentPayload({
      destination: DESTINATION_A,
      amount: '100.0000000',
      asset: creditAsset,
    });
    assert.equal(
      uri,
      `web+stellar:pay?destination=${DESTINATION_A}&amount=100.0000000&asset_code=USDC&asset_issuer=${ISSUER_USDC}`
    );
  });

  it('omits memo parameters when memo is empty string or whitespace only', () => {
    const uri1 = formatQrPaymentPayload({
      destination: DESTINATION_A,
      amount: '10',
      memo: '',
    });
    assert.equal(uri1, `web+stellar:pay?destination=${DESTINATION_A}&amount=10`);

    const uri2 = formatQrPaymentPayload({
      destination: DESTINATION_A,
      amount: '10',
      memo: '   ',
    });
    assert.equal(uri2, `web+stellar:pay?destination=${DESTINATION_A}&amount=10`);
  });

  it('correctly encodes unicode and special characters in memo', () => {
    const uri = formatQrPaymentPayload({
      destination: DESTINATION_A,
      amount: '15',
      memo: 'Café ☕ & croissant #12',
    });
    const expectedMemoEncoded = encodeURIComponent('Café ☕ & croissant #12');
    assert.equal(
      uri,
      `web+stellar:pay?destination=${DESTINATION_A}&amount=15&memo=${expectedMemoEncoded}&memo_type=MEMO_TEXT`
    );
  });
});
