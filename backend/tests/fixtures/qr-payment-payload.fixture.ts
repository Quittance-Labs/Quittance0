// Fixture data for QR payment payload formatting unit tests (SEP-0007).

import type { FormatQrPaymentPayloadOptions } from '../../src/utils/qr-payment-payload';

export interface QrPaymentPayloadTestCase {
  name: string;
  input: FormatQrPaymentPayloadOptions;
  expectedResult: string;
}

export interface QrPaymentPayloadErrorCase {
  name: string;
  input: any;
  expectedErrorMessage: string;
}

const DESTINATION_A = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ISSUER_USDC = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

export const QR_PAYMENT_PAYLOAD_FIXTURES: QrPaymentPayloadTestCase[] = [
  {
    name: 'formats native XLM payment with string amount',
    input: {
      destination: DESTINATION_A,
      amount: '100.5000000',
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=100.5000000`,
  },
  {
    name: 'formats native XLM payment with number amount',
    input: {
      destination: DESTINATION_A,
      amount: 50,
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=50`,
  },
  {
    name: 'formats native XLM payment with memo',
    input: {
      destination: DESTINATION_A,
      amount: '25.0000000',
      memo: 'INV-2026-ABC',
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=25.0000000&memo=INV-2026-ABC&memo_type=MEMO_TEXT`,
  },
  {
    name: 'encodes special characters and spaces in memo',
    input: {
      destination: DESTINATION_A,
      amount: '10.0000000',
      memo: 'Invoice #42 & receipt / 2026',
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=10.0000000&memo=Invoice%20%2342%20%26%20receipt%20%2F%202026&memo_type=MEMO_TEXT`,
  },
  {
    name: 'formats credit asset with asset object',
    input: {
      destination: DESTINATION_A,
      amount: '200.0000000',
      asset: {
        code: 'USDC',
        issuer: ISSUER_USDC,
      },
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=200.0000000&asset_code=USDC&asset_issuer=${ISSUER_USDC}`,
  },
  {
    name: 'formats credit asset with assetCode and assetIssuer fields',
    input: {
      destination: DESTINATION_A,
      amount: '75.0000000',
      assetCode: 'USDC',
      assetIssuer: ISSUER_USDC,
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=75.0000000&asset_code=USDC&asset_issuer=${ISSUER_USDC}`,
  },
  {
    name: 'formats credit asset with memo and custom memoType',
    input: {
      destination: DESTINATION_A,
      amount: '150.0000000',
      asset: {
        code: 'USDC',
        issuer: ISSUER_USDC,
      },
      memo: '123456789',
      memoType: 'MEMO_ID',
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=150.0000000&asset_code=USDC&asset_issuer=${ISSUER_USDC}&memo=123456789&memo_type=MEMO_ID`,
  },
  {
    name: 'formats payment with zero amount',
    input: {
      destination: DESTINATION_A,
      amount: '0',
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=0`,
  },
  {
    name: 'formats payment without amount (amount omitted)',
    input: {
      destination: DESTINATION_A,
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}`,
  },
  {
    name: 'formats native XLM payment when asset is explicitly string "XLM"',
    input: {
      destination: DESTINATION_A,
      amount: '10.0000000',
      asset: 'XLM',
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=10.0000000`,
  },
  {
    name: 'formats native XLM payment when asset object is native identity',
    input: {
      destination: DESTINATION_A,
      amount: '10.0000000',
      asset: {
        kind: 'native',
        code: 'XLM',
      },
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=10.0000000`,
  },
  {
    name: 'trims whitespace from destination, memo, and asset fields',
    input: {
      destination: `  ${DESTINATION_A}  `,
      amount: ' 30.0000000 ',
      asset: {
        code: ' USDC ',
        issuer: `  ${ISSUER_USDC}  `,
      },
      memo: '  INV-TRIMMED  ',
    },
    expectedResult: `web+stellar:pay?destination=${DESTINATION_A}&amount=30.0000000&asset_code=USDC&asset_issuer=${ISSUER_USDC}&memo=INV-TRIMMED&memo_type=MEMO_TEXT`,
  },
];

export const QR_PAYMENT_PAYLOAD_ERROR_FIXTURES: QrPaymentPayloadErrorCase[] = [
  {
    name: 'throws error when options is undefined or null',
    input: null,
    expectedErrorMessage: 'Options object is required for formatQrPaymentPayload',
  },
  {
    name: 'throws error when destination is missing',
    input: {
      destination: '',
      amount: '100',
    },
    expectedErrorMessage: 'Destination is required for QR payment payload',
  },
  {
    name: 'throws error when destination is whitespace only',
    input: {
      destination: '   ',
      amount: '100',
    },
    expectedErrorMessage: 'Destination is required for QR payment payload',
  },
];

export default {
  QR_PAYMENT_PAYLOAD_FIXTURES,
  QR_PAYMENT_PAYLOAD_ERROR_FIXTURES,
};
