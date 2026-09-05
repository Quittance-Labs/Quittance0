import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatQrPaymentPayload } from '../src/utils/qr-payment-payload.js';
import {
  validXlmPayloadOptions,
  validXlmPayloadWithMemo,
  validNonNativeAssetPayload,
  validObjectAssetPayload,
  specialCharMemoPayload,
} from './fixtures/qr-payment-payload.fixture.js';

describe('formatQrPaymentPayload', () => {
  it('formats basic XLM payment URI correctly', () => {
    const uri = formatQrPaymentPayload(validXlmPayloadOptions);
    assert.equal(
      uri,
      'web+stellar:pay?destination=GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K&amount=100.50'
    );
  });

  it('formats XLM payment with memo and MEMO_TEXT type', () => {
    const uri = formatQrPaymentPayload(validXlmPayloadWithMemo);
    assert.equal(
      uri,
      'web+stellar:pay?destination=GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K&amount=50&memo=INV-2026-001&memo_type=MEMO_TEXT'
    );
  });

  it('formats non-native asset with code and issuer', () => {
    const uri = formatQrPaymentPayload(validNonNativeAssetPayload);
    assert.equal(
      uri,
      'web+stellar:pay?destination=GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K&amount=25.75&asset_code=USDC&asset_issuer=GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5&memo=INV-456&memo_type=MEMO_TEXT'
    );
  });

  it('formats object asset with code and issuer and numeric amount', () => {
    const uri = formatQrPaymentPayload(validObjectAssetPayload);
    assert.equal(
      uri,
      'web+stellar:pay?destination=GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K&amount=1000&asset_code=EURC&asset_issuer=GDJTX22JHHAXNP2SNO7NNEO6N43WNCXW2ZCG6476QST5V53YV26E6H2G&memo=Payment%20for%20services&memo_type=MEMO_TEXT'
    );
  });

  it('URL-encodes special characters in memo properly', () => {
    const uri = formatQrPaymentPayload(specialCharMemoPayload);
    assert.ok(uri.includes('&memo=INV%2F2026%23001%20%26%20test%3D1&memo_type=MEMO_TEXT'));
  });

  it('omits asset params when asset is XLM even if assetIssuer is passed', () => {
    const uri = formatQrPaymentPayload({
      destination: 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K',
      amount: '10',
      asset: 'XLM',
      assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    });
    assert.equal(
      uri,
      'web+stellar:pay?destination=GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K&amount=10'
    );
  });

  it('omits asset params when asset is non-native but issuer is missing', () => {
    const uri = formatQrPaymentPayload({
      destination: 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K',
      amount: '10',
      asset: 'USDC',
    });
    assert.equal(
      uri,
      'web+stellar:pay?destination=GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K&amount=10'
    );
  });

  it('throws error when destination is missing or invalid', () => {
    assert.throws(
      () => formatQrPaymentPayload({ destination: '', amount: '10' }),
      /Destination address is required/
    );
    assert.throws(
      () => formatQrPaymentPayload({ destination: null as any, amount: '10' }),
      /Destination address is required/
    );
  });

  it('throws error when amount is missing or invalid', () => {
    assert.throws(
      () => formatQrPaymentPayload({ destination: 'GA2C5...', amount: '' }),
      /Amount is required/
    );
    assert.throws(
      () => formatQrPaymentPayload({ destination: 'GA2C5...', amount: undefined as any }),
      /Amount is required/
    );
  });
});
