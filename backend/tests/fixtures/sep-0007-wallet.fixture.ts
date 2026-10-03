import {
  VALID_ASSET_ISSUER,
  VALID_DESTINATION,
} from './qr-payment-payload.fixture';
import type { StellarNetwork } from '../../../shared/network';
import {
  PUBLIC_PASSPHRASE,
  TESTNET_PASSPHRASE,
} from '../../../shared/network';

export interface Sep7ResearchVector {
  name: string;
  input: {
    destination: string;
    amount: string;
    memo?: string;
    asset?: { code: string; issuer?: string };
    network?: StellarNetwork;
    networkPassphrase?: string;
  };
  recommendation: 'accept' | 'reject';
  current: 'accept' | 'reject' | 'gap';
  expectedError?: string;
  expectedUri?: string;
  walletNote: string;
}

export const SEP7_RESEARCH_VECTORS: Sep7ResearchVector[] = [
  {
    name: 'native public-network invoice',
    input: {
      destination: VALID_DESTINATION,
      amount: '12.3400000',
      memo: 'Q-382-1',
      network: 'PUBLIC',
    },
    recommendation: 'accept',
    current: 'accept',
    expectedUri:
      `web+stellar:pay?destination=${VALID_DESTINATION}&amount=12.3400000&memo=Q-382-1&memo_type=MEMO_TEXT`,
    walletNote: 'XLM is implied when asset_code and asset_issuer are absent. Public omits network_passphrase.',
  },
  {
    name: 'issued asset pins code and issuer',
    input: {
      destination: VALID_DESTINATION,
      amount: '5.25',
      memo: 'Q-382-2',
      asset: { code: 'USDC', issuer: VALID_ASSET_ISSUER },
      network: 'PUBLIC',
    },
    recommendation: 'accept',
    current: 'accept',
    expectedUri:
      `web+stellar:pay?destination=${VALID_DESTINATION}&amount=5.2500000&asset_code=USDC&asset_issuer=${VALID_ASSET_ISSUER}&memo=Q-382-2&memo_type=MEMO_TEXT`,
    walletNote: 'Wallet may use a path payment, but the destination must receive this exact asset.',
  },
  {
    name: '28-byte ASCII text memo',
    input: {
      destination: VALID_DESTINATION,
      amount: '1',
      memo: '1234567890123456789012345678',
      network: 'PUBLIC',
    },
    recommendation: 'accept',
    current: 'accept',
    expectedUri:
      `web+stellar:pay?destination=${VALID_DESTINATION}&amount=1.0000000&memo=1234567890123456789012345678&memo_type=MEMO_TEXT`,
    walletNote: 'MEMO_TEXT allows at most 28 UTF-8 bytes.',
  },
  {
    name: '29-byte text memo',
    input: { destination: VALID_DESTINATION, amount: '1', memo: '12345678901234567890123456789' },
    recommendation: 'reject',
    current: 'reject',
    expectedError: 'memo exceeds the 28-byte Stellar text memo limit',
    walletNote: 'The formatter rejects it: a wallet cannot build a valid Stellar text memo.',
  },
  {
    name: 'eight emoji memo is 32 UTF-8 bytes',
    input: { destination: VALID_DESTINATION, amount: '1', memo: '😀😀😀😀😀😀😀😀' },
    recommendation: 'reject',
    current: 'reject',
    expectedError: 'memo exceeds the 28-byte Stellar text memo limit',
    walletNote: 'The formatter validates UTF-8 byte length rather than JavaScript character count.',
  },
  {
    name: 'missing amount on an invoice',
    input: { destination: VALID_DESTINATION, amount: '' },
    recommendation: 'reject',
    current: 'reject',
    expectedError: 'amount is required',
    walletNote: 'SEP-7 permits donation URIs without amount; Quittance invoices require an exact amount.',
  },
  {
    name: 'Testnet invoice includes Testnet passphrase',
    input: {
      destination: VALID_DESTINATION,
      amount: '2',
      memo: 'Q-382-TEST',
      network: 'TESTNET',
    },
    recommendation: 'accept',
    current: 'accept',
    expectedUri:
      `web+stellar:pay?destination=${VALID_DESTINATION}&amount=2.0000000&memo=Q-382-TEST&memo_type=MEMO_TEXT&network_passphrase=${encodeURIComponent(TESTNET_PASSPHRASE)}`,
    walletNote: 'SEP-7 defaults to public network, so Testnet must be explicit and URL-encoded.',
  },
  {
    name: 'public passphrase on a Testnet invoice',
    input: {
      destination: VALID_DESTINATION,
      amount: '2',
      memo: 'Q-382-WRONG',
      network: 'TESTNET',
      networkPassphrase: PUBLIC_PASSPHRASE,
    },
    recommendation: 'reject',
    current: 'reject',
    expectedError: 'network passphrase does not match the invoice network',
    walletNote: 'The formatter receives the invoice network and rejects a conflicting hint.',
  },
  {
    name: 'issued asset without issuer',
    input: { destination: VALID_DESTINATION, amount: '3', asset: { code: 'USDC' } },
    recommendation: 'reject',
    current: 'reject',
    expectedError: 'asset issuer is required for USDC',
    walletNote: 'An asset code alone does not identify a Stellar credit asset.',
  },
];

export { PUBLIC_PASSPHRASE, TESTNET_PASSPHRASE };
