// Path-payment rows below are synthetic verifier examples using legacy dest_* aliases.
// Exact, unchanged Horizon path-payment receipts are in monitor-testnet-receipts.json.
import {
  VerifyPaymentInput,
  ExpectedPayment,
  HorizonTransactionLike,
  HorizonOperationLike,
  VerificationCode,
} from '../../src/services/payment-verification';

export const CIRCLE_USDC_TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
export const ROGUE_USDC_ISSUER = 'GCKFJ3227TG52T547K6DCF542W42PP44CX444R2PP44CX444R2PP44C5';

export const REAL_TESTNET_TX_USDC_20 = '2a4261f890848f037bd45bc9860d6065757f6d8389e030945b148a0e625cf7bd';
export const REAL_TESTNET_TX_USDC_100 = 'ffa806b714bea1443ded88bff1f2b472905513deded3ba0b7cbd0f797a19854c';
export const REAL_TESTNET_TX_USDC_0_1 = '0334cd305019c8a73db6562d1c5f6351f4eead1220b100383b7d022683619d5d';
export const REAL_TESTNET_TX_XLM_MEMO = '2f2d26b1a3399181a99017ebe78ce64f84da7e2c9e0b1d0545bda1f2f0bc0d08';

export interface UsdcTestCase {
  name: string;
  description: string;
  expectedResult: boolean;
  expectedCode?: VerificationCode;
  input: VerifyPaymentInput;
}

export const USDC_VERIFY_CASES: UsdcTestCase[] = [
  {
    name: 'real testnet USDC exact payment accept',
    description: 'Accepts real on-chain transaction 2a42... matching Circle issuer, destination, and exact amount',
    expectedResult: true,
    input: {
      txHash: REAL_TESTNET_TX_USDC_20,
      network: 'TESTNET',
      expected: {
        memo: '',
        amount: '20.0000000',
        destination: CIRCLE_USDC_TESTNET_ISSUER,
        assetCode: 'USDC',
        assetIssuer: CIRCLE_USDC_TESTNET_ISSUER,
        network: 'TESTNET',
      },
      transaction: {
        memo: null,
        memo_type: 'none',
      },
      operations: [
        {
          type: 'payment',
          from: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
          to: CIRCLE_USDC_TESTNET_ISSUER,
          amount: '20.0000000',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: CIRCLE_USDC_TESTNET_ISSUER,
        },
      ],
    },
  },
  {
    name: 'real testnet USDC wrong issuer rejection',
    description: 'Rejects on-chain USDC payment when invoice specifies a different issuer than the payment token',
    expectedResult: false,
    expectedCode: 'ASSET_MISMATCH',
    input: {
      txHash: REAL_TESTNET_TX_USDC_20,
      network: 'TESTNET',
      expected: {
        memo: '',
        amount: '20.0000000',
        destination: CIRCLE_USDC_TESTNET_ISSUER,
        assetCode: 'USDC',
        assetIssuer: ROGUE_USDC_ISSUER,
        network: 'TESTNET',
      },
      transaction: {
        memo: null,
        memo_type: 'none',
      },
      operations: [
        {
          type: 'payment',
          from: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
          to: CIRCLE_USDC_TESTNET_ISSUER,
          amount: '20.0000000',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: CIRCLE_USDC_TESTNET_ISSUER,
        },
      ],
    },
  },
  {
    name: 'real testnet USDC underpayment rejection',
    description: 'Rejects real on-chain transaction ffa8... when invoice demands 150 USDC but 100 USDC was paid',
    expectedResult: false,
    expectedCode: 'AMOUNT_TOO_LOW',
    input: {
      txHash: REAL_TESTNET_TX_USDC_100,
      network: 'TESTNET',
      expected: {
        memo: '',
        amount: '150.0000000',
        destination: CIRCLE_USDC_TESTNET_ISSUER,
        assetCode: 'USDC',
        assetIssuer: CIRCLE_USDC_TESTNET_ISSUER,
        network: 'TESTNET',
      },
      transaction: {
        memo: null,
        memo_type: 'none',
      },
      operations: [
        {
          type: 'payment',
          from: 'GCT7D6S5VTFGEURS6ZYIO33YZRPQMA3LNWB4GEOHDFDXZGWTA4EPIM5E',
          to: CIRCLE_USDC_TESTNET_ISSUER,
          amount: '100.0000000',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: CIRCLE_USDC_TESTNET_ISSUER,
        },
      ],
    },
  },
  {
    name: 'real testnet USDC overpayment rejection',
    description: 'Rejects real on-chain transaction ffa8... when invoice demands 50 USDC but 100 USDC was paid',
    expectedResult: false,
    expectedCode: 'AMOUNT_TOO_HIGH',
    input: {
      txHash: REAL_TESTNET_TX_USDC_100,
      network: 'TESTNET',
      expected: {
        memo: '',
        amount: '50.0000000',
        destination: CIRCLE_USDC_TESTNET_ISSUER,
        assetCode: 'USDC',
        assetIssuer: CIRCLE_USDC_TESTNET_ISSUER,
        network: 'TESTNET',
      },
      transaction: {
        memo: null,
        memo_type: 'none',
      },
      operations: [
        {
          type: 'payment',
          from: 'GCT7D6S5VTFGEURS6ZYIO33YZRPQMA3LNWB4GEOHDFDXZGWTA4EPIM5E',
          to: CIRCLE_USDC_TESTNET_ISSUER,
          amount: '100.0000000',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: CIRCLE_USDC_TESTNET_ISSUER,
        },
      ],
    },
  },
  {
    name: 'real testnet USDC destination mismatch rejection',
    description: 'Rejects real on-chain transaction 0334... when destination wallet does not match invoice destination',
    expectedResult: false,
    expectedCode: 'DESTINATION_MISMATCH',
    input: {
      txHash: REAL_TESTNET_TX_USDC_0_1,
      network: 'TESTNET',
      expected: {
        memo: '',
        amount: '0.1000000',
        destination: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
        assetCode: 'USDC',
        assetIssuer: CIRCLE_USDC_TESTNET_ISSUER,
        network: 'TESTNET',
      },
      transaction: {
        memo: null,
        memo_type: 'none',
      },
      operations: [
        {
          type: 'payment',
          from: 'GAVQ7574Q3PNOZNIMDODRZHR7A64VHPCR5TQL2R7VQEWJFMTPQFY5CNM',
          to: CIRCLE_USDC_TESTNET_ISSUER,
          amount: '0.1000000',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: CIRCLE_USDC_TESTNET_ISSUER,
        },
      ],
    },
  },
  {
    name: 'real testnet transaction network mismatch rejection',
    description: 'Rejects transaction when network observed by client is TESTNET but invoice is PUBLIC',
    expectedResult: false,
    expectedCode: 'NETWORK_MISMATCH',
    input: {
      txHash: REAL_TESTNET_TX_USDC_20,
      network: 'TESTNET',
      expected: {
        memo: '',
        amount: '20.0000000',
        destination: CIRCLE_USDC_TESTNET_ISSUER,
        assetCode: 'USDC',
        assetIssuer: CIRCLE_USDC_TESTNET_ISSUER,
        network: 'PUBLIC',
      },
      transaction: {
        memo: null,
        memo_type: 'none',
      },
      operations: [
        {
          type: 'payment',
          from: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
          to: CIRCLE_USDC_TESTNET_ISSUER,
          amount: '20.0000000',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: CIRCLE_USDC_TESTNET_ISSUER,
        },
      ],
    },
  },
  {
    name: 'path payment strict receive accept',
    description: 'Accepts path_payment_strict_receive delivering exact destination USDC amount',
    expectedResult: true,
    input: {
      txHash: REAL_TESTNET_TX_USDC_20,
      network: 'TESTNET',
      expected: {
        memo: 'INV-PATH-01',
        amount: '20.0000000',
        destination: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
        assetCode: 'USDC',
        assetIssuer: CIRCLE_USDC_TESTNET_ISSUER,
        network: 'TESTNET',
      },
      transaction: {
        memo: 'INV-PATH-01',
        memo_type: 'text',
      },
      operations: [
        {
          type: 'path_payment_strict_receive',
          from: 'GCUXM6OT4H6PD7R6YUS632SDK36BYKDESGS4BSHTPTPDXBCYTE6JUEJE',
          to: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
          amount: '20.0000000',
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: CIRCLE_USDC_TESTNET_ISSUER,
          source_amount: '160.0000000',
          source_asset_type: 'native',
        },
      ],
    },
  },
  {
    name: 'path payment strict send accept',
    description: 'Accepts path_payment_strict_send delivering matching dest_amount of USDC to destination',
    expectedResult: true,
    input: {
      txHash: REAL_TESTNET_TX_USDC_20,
      network: 'TESTNET',
      expected: {
        memo: 'INV-PATH-02',
        amount: '25.0000000',
        destination: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
        assetCode: 'USDC',
        assetIssuer: CIRCLE_USDC_TESTNET_ISSUER,
        network: 'TESTNET',
      },
      transaction: {
        memo: 'INV-PATH-02',
        memo_type: 'text',
      },
      operations: [
        {
          type: 'path_payment_strict_send',
          from: 'GCUXM6OT4H6PD7R6YUS632SDK36BYKDESGS4BSHTPTPDXBCYTE6JUEJE',
          to: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
          dest_amount: '25.0000000',
          dest_asset_type: 'credit_alphanum4',
          dest_asset_code: 'USDC',
          dest_asset_issuer: CIRCLE_USDC_TESTNET_ISSUER,
          amount: '200.0000000',
          source_asset_type: 'native',
        },
      ],
    },
  },
  {
    name: 'path payment strict send underpayment rejection',
    description: 'Rejects path_payment_strict_send when delivered dest_amount is less than expected',
    expectedResult: false,
    expectedCode: 'AMOUNT_TOO_LOW',
    input: {
      txHash: REAL_TESTNET_TX_USDC_20,
      network: 'TESTNET',
      expected: {
        memo: 'INV-PATH-03',
        amount: '30.0000000',
        destination: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
        assetCode: 'USDC',
        assetIssuer: CIRCLE_USDC_TESTNET_ISSUER,
        network: 'TESTNET',
      },
      transaction: {
        memo: 'INV-PATH-03',
        memo_type: 'text',
      },
      operations: [
        {
          type: 'path_payment_strict_send',
          from: 'GCUXM6OT4H6PD7R6YUS632SDK36BYKDESGS4BSHTPTPDXBCYTE6JUEJE',
          to: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
          dest_amount: '25.0000000',
          dest_asset_type: 'credit_alphanum4',
          dest_asset_code: 'USDC',
          dest_asset_issuer: CIRCLE_USDC_TESTNET_ISSUER,
          amount: '200.0000000',
          source_asset_type: 'native',
        },
      ],
    },
  },
  {
    name: 'path payment strict receive wrong asset rejection',
    description: 'Rejects path_payment_strict_receive when destination asset does not match invoice credit asset',
    expectedResult: false,
    expectedCode: 'ASSET_MISMATCH',
    input: {
      txHash: REAL_TESTNET_TX_USDC_20,
      network: 'TESTNET',
      expected: {
        memo: 'INV-PATH-04',
        amount: '20.0000000',
        destination: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
        assetCode: 'USDC',
        assetIssuer: CIRCLE_USDC_TESTNET_ISSUER,
        network: 'TESTNET',
      },
      transaction: {
        memo: 'INV-PATH-04',
        memo_type: 'text',
      },
      operations: [
        {
          type: 'path_payment_strict_receive',
          from: 'GCUXM6OT4H6PD7R6YUS632SDK36BYKDESGS4BSHTPTPDXBCYTE6JUEJE',
          to: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
          amount: '20.0000000',
          asset_type: 'native',
        },
      ],
    },
  },
];
