// Fixture data shared by the QR payment payload unit tests.

export const VALID_DESTINATION =
  'GAV5XS3IZFW5O677MRHOBKL74UASTVURZQMW5TQLQVXKLKX4QCJQ2JHJ';

export const VALID_ASSET_ISSUER =
  'GB274VQWI75MLT4AKUQGF5KSQIMEEBQFCWZUSRDWIWJMX5SMHRWIRXHN';

export const INVALID_PUBLIC_KEY = 'NOT_A_VALID_KEY';

export interface QrPayloadFixtureCase {
  name: string;
  input: {
    destination: string;
    amount: string;
    memo?: string;
    asset?: { code: string; issuer?: string };
  };
  expected: {
    uri: string;
    params: Record<string, string>;
  };
}

export const VALID_CASES: QrPayloadFixtureCase[] = [
  {
    name: 'native asset with destination and amount only',
    input: {
      destination: VALID_DESTINATION,
      amount: '100',
    },
    expected: {
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=100`,
      params: {
        destination: VALID_DESTINATION,
        amount: '100',
      },
    },
  },
  {
    name: 'native asset with a text memo',
    input: {
      destination: VALID_DESTINATION,
      amount: '42.50',
      memo: 'Invoice #1234',
    },
    expected: {
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=42.50&memo=${encodeURIComponent(
        'Invoice #1234',
      )}&memo_type=MEMO_TEXT`,
      params: {
        destination: VALID_DESTINATION,
        amount: '42.50',
        memo: 'Invoice #1234',
        memo_type: 'MEMO_TEXT',
      },
    },
  },
  {
    name: 'custom asset with issuer',
    input: {
      destination: VALID_DESTINATION,
      amount: '10',
      asset: {
        code: 'USDC',
        issuer: VALID_ASSET_ISSUER,
      },
    },
    expected: {
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=10&asset_code=USDC&asset_issuer=${VALID_ASSET_ISSUER}`,
      params: {
        destination: VALID_DESTINATION,
        amount: '10',
        asset_code: 'USDC',
        asset_issuer: VALID_ASSET_ISSUER,
      },
    },
  },
  {
    name: 'custom asset with memo lowercases code to uppercase',
    input: {
      destination: VALID_DESTINATION,
      amount: '7.5',
      memo: 'tip',
      asset: {
        code: ' usdc ',
        issuer: VALID_ASSET_ISSUER,
      },
    },
    expected: {
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=7.5&asset_code=USDC&asset_issuer=${VALID_ASSET_ISSUER}&memo=tip&memo_type=MEMO_TEXT`,
      params: {
        destination: VALID_DESTINATION,
        amount: '7.5',
        asset_code: 'USDC',
        asset_issuer: VALID_ASSET_ISSUER,
        memo: 'tip',
        memo_type: 'MEMO_TEXT',
      },
    },
  },
];

export interface QrPayloadErrorCase {
  name: string;
  input: QrPayloadFixtureCase['input'];
  expectedError: string;
}

export const ERROR_CASES: QrPayloadErrorCase[] = [
  {
    name: 'missing destination',
    input: {
      destination: '',
      amount: '100',
    },
    expectedError: 'destination is required',
  },
  {
    name: 'invalid destination public key',
    input: {
      destination: INVALID_PUBLIC_KEY,
      amount: '100',
    },
    expectedError: 'destination must be a valid Stellar public key',
  },
  {
    name: 'missing amount',
    input: {
      destination: VALID_DESTINATION,
      amount: '',
    },
    expectedError: 'amount is required',
  },
  {
    name: 'zero amount',
    input: {
      destination: VALID_DESTINATION,
      amount: '0',
    },
    expectedError: 'amount must be a positive number',
  },
  {
    name: 'negative amount',
    input: {
      destination: VALID_DESTINATION,
      amount: '-10',
    },
    expectedError: 'amount must be a positive number',
  },
  {
    name: 'custom asset missing issuer',
    input: {
      destination: VALID_DESTINATION,
      amount: '10',
      asset: {
        code: 'USDC',
      },
    },
    expectedError: 'asset issuer is required for USDC',
  },
  {
    name: 'custom asset with invalid issuer',
    input: {
      destination: VALID_DESTINATION,
      amount: '10',
      asset: {
        code: 'USDC',
        issuer: INVALID_PUBLIC_KEY,
      },
    },
    expectedError: 'asset issuer must be a valid Stellar public key',
  },
];

export default {
  VALID_DESTINATION,
  VALID_ASSET_ISSUER,
  INVALID_PUBLIC_KEY,
  VALID_CASES,
  ERROR_CASES,
};
