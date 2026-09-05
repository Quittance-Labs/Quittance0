import type { FormatQrPaymentPayloadOptions } from '../../src/utils/qr-payment-payload.js';

export const validXlmPayloadOptions: FormatQrPaymentPayloadOptions = {
  destination: 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K',
  amount: '100.50',
};

export const validXlmPayloadWithMemo: FormatQrPaymentPayloadOptions = {
  destination: 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K',
  amount: '50',
  memo: 'INV-2026-001',
};

export const validNonNativeAssetPayload: FormatQrPaymentPayloadOptions = {
  destination: 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K',
  amount: '25.75',
  asset: 'USDC',
  assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  memo: 'INV-456',
};

export const validObjectAssetPayload: FormatQrPaymentPayloadOptions = {
  destination: 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K',
  amount: 1000,
  asset: {
    code: 'EURC',
    issuer: 'GDJTX22JHHAXNP2SNO7NNEO6N43WNCXW2ZCG6476QST5V53YV26E6H2G',
  },
  memo: 'Payment for services',
};

export const specialCharMemoPayload: FormatQrPaymentPayloadOptions = {
  destination: 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPWMR256R4WVYVA3K',
  amount: '10',
  memo: 'INV/2026#001 & test=1',
};
