import type {
  ExpectedPayment,
  HorizonOperationLike,
  HorizonTransactionLike,
  VerificationCode,
} from '../../src/services/payment-verification';

export const TEST_SELLER = 'GSELLERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const TEST_PAYER = 'GPAYERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const TEST_OTHER = 'GOTHERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const TEST_USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const TEST_TX_HASH = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

export interface MultiOpTestCase {
  name: string;
  expectedResult: boolean;
  expectedCode?: VerificationCode;
  expectedPayment: ExpectedPayment;
  transaction: HorizonTransactionLike;
  operations: HorizonOperationLike[];
}

export const MULTI_OP_FIXTURES: MultiOpTestCase[] = [
  {
    name: 'change_trust preceding matching native XLM payment settles invoice',
    expectedResult: true,
    expectedPayment: {
      memo: 'INV-101',
      amount: '50.0000000',
      destination: TEST_SELLER,
      assetCode: 'XLM',
    },
    transaction: {
      memo: 'INV-101',
      memo_type: 'text',
      created_at: '2026-03-01T12:00:00Z',
    },
    operations: [
      {
        type: 'change_trust',
        from: TEST_PAYER,
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: TEST_USDC_ISSUER,
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '50.0000000',
        asset_type: 'native',
      },
    ],
  },
  {
    name: 'change_trust preceding matching credit USDC payment settles invoice',
    expectedResult: true,
    expectedPayment: {
      memo: 'INV-102',
      amount: '100.0000000',
      destination: TEST_SELLER,
      assetCode: 'USDC',
      assetIssuer: TEST_USDC_ISSUER,
    },
    transaction: {
      memo: 'INV-102',
      memo_type: 'text',
      created_at: '2026-03-01T12:00:00Z',
    },
    operations: [
      {
        type: 'change_trust',
        from: TEST_PAYER,
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: TEST_USDC_ISSUER,
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '100.0000000',
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: TEST_USDC_ISSUER,
      },
    ],
  },
  {
    name: 'two identical matching payments fail closed with MULTIPLE_PAYMENT_OPERATIONS',
    expectedResult: false,
    expectedCode: 'MULTIPLE_PAYMENT_OPERATIONS',
    expectedPayment: {
      memo: 'INV-103',
      amount: '25.0000000',
      destination: TEST_SELLER,
      assetCode: 'XLM',
    },
    transaction: {
      memo: 'INV-103',
      memo_type: 'text',
    },
    operations: [
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '25.0000000',
        asset_type: 'native',
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '25.0000000',
        asset_type: 'native',
      },
    ],
  },
  {
    name: 'payment to wrong destination ignored when matching payment exists',
    expectedResult: true,
    expectedPayment: {
      memo: 'INV-104',
      amount: '75.0000000',
      destination: TEST_SELLER,
      assetCode: 'XLM',
    },
    transaction: {
      memo: 'INV-104',
      memo_type: 'text',
      created_at: '2026-03-01T12:00:00Z',
    },
    operations: [
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_OTHER,
        amount: '75.0000000',
        asset_type: 'native',
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '75.0000000',
        asset_type: 'native',
      },
    ],
  },
  {
    name: 'matching payment later in operation list after unrelated ops is found',
    expectedResult: true,
    expectedPayment: {
      memo: 'INV-105',
      amount: '120.0000000',
      destination: TEST_SELLER,
      assetCode: 'USDC',
      assetIssuer: TEST_USDC_ISSUER,
    },
    transaction: {
      memo: 'INV-105',
      memo_type: 'text',
      created_at: '2026-03-01T12:00:00Z',
    },
    operations: [
      {
        type: 'manage_data',
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_OTHER,
        amount: '50.0000000',
        asset_type: 'native',
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '120.0000000',
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: TEST_USDC_ISSUER,
      },
    ],
  },
  {
    name: 'multiple partial payments that sum to invoice amount fail closed without summing',
    expectedResult: false,
    expectedCode: 'AMOUNT_TOO_LOW',
    expectedPayment: {
      memo: 'INV-106',
      amount: '100.0000000',
      destination: TEST_SELLER,
      assetCode: 'XLM',
    },
    transaction: {
      memo: 'INV-106',
      memo_type: 'text',
    },
    operations: [
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '50.0000000',
        asset_type: 'native',
      },
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '50.0000000',
        asset_type: 'native',
      },
    ],
  },
  {
    name: 'fee-bump inner transaction memo resolution matches expected memo',
    expectedResult: true,
    expectedPayment: {
      memo: 'INNER-MEMO-42',
      amount: '10.0000000',
      destination: TEST_SELLER,
      assetCode: 'XLM',
    },
    transaction: {
      memo: null,
      inner_transaction: {
        memo: 'INNER-MEMO-42',
        memo_type: 'text',
      },
      created_at: '2026-03-01T12:00:00Z',
    },
    operations: [
      {
        type: 'payment',
        from: TEST_PAYER,
        to: TEST_SELLER,
        amount: '10.0000000',
        asset_type: 'native',
      },
    ],
  },
];
