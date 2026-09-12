// Fixture data for the SEP-0007 payment URI conformance suite (issue #382).
//
// Every `expected` value here was produced by running the current formatter and
// the current Stellar SDK, not by reading them. The point of the suite is to pin
// what the product emits today so the follow-up formatter change has a diff to
// show, and to keep the five documented gaps in one place instead of in prose
// nobody re-reads.
//
// status: 'conformant' — the current output matches what SEP-0007 and the SDK
//                         allow, and a wallet has something valid to work with
//         'gap'        — the formatter emits something a wallet or the SDK will
//                         refuse, or drops information silently

import type { QrPaymentPayloadInput } from '../../src/utils/qr-payment-payload';
import { VALID_ASSET_ISSUER, VALID_DESTINATION } from './qr-payment-payload.fixture';

/**
 * A muxed account id (M...) for the same underlying key as VALID_DESTINATION,
 * muxed id 0. SEP-0007 accepts "a valid account ID or payment address"; this is
 * the second form.
 */
export const MUXED_DESTINATION =
  'MAV5XS3IZFW5O677MRHOBKL74UASTVURZQMW5TQLQVXKLKX4QCJQ2AAAAAAAAAAAADDUI';

/** The shape the product emits for an invoice: INV-<base36 ms>-<8 chars>, 21 chars. */
export const INVOICE_MEMO = 'INV-LX7Q9A3B-KM2P8NQR';

/** Exactly the protocol's 28-byte ceiling for MEMO_TEXT. */
export const MEMO_28_BYTES = 'INV-' + 'A'.repeat(20) + '-' + 'B'.repeat(3);

/** Four bytes over the ceiling. */
export const MEMO_32_BYTES = MEMO_28_BYTES + 'CCCC';

/** Ten coffee cups: 10 characters, 30 bytes. The ceiling counts bytes. */
export const MEMO_30_BYTES_NON_ASCII = '\u2615'.repeat(10);

export type UriCaseStatus = 'conformant' | 'gap';

export interface PaymentUriCase {
  name: string;
  /** What this case establishes, in one line. */
  why: string;
  status: UriCaseStatus;
  input: QrPaymentPayloadInput;
  /** Gap cases only: what the follow-up should do instead. */
  followUp?: string;
  expected:
    | { kind: 'uri'; uri: string; params: Record<string, string> }
    | { kind: 'throws'; message: string };
}

export const PAYMENT_URI_CASES: PaymentUriCase[] = [
  {
    name: 'native payment: no asset_code means XLM',
    why: 'SEP-0007 reads a missing asset_code as the native asset, so the shortest URI is also the correct one.',
    status: 'conformant',
    input: { destination: VALID_DESTINATION, amount: '25' },
    expected: {
      kind: 'uri',
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=25`,
      params: { destination: VALID_DESTINATION, amount: '25' },
    },
  },
  {
    name: 'invoice memo: the shape the product actually emits',
    why: 'The generated memo is 21 characters, well inside the 28-byte ceiling, and is tagged MEMO_TEXT.',
    status: 'conformant',
    input: { destination: VALID_DESTINATION, amount: '25', memo: INVOICE_MEMO },
    expected: {
      kind: 'uri',
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=25&memo=${INVOICE_MEMO}&memo_type=MEMO_TEXT`,
      params: {
        destination: VALID_DESTINATION,
        amount: '25',
        memo: INVOICE_MEMO,
        memo_type: 'MEMO_TEXT',
      },
    },
  },
  {
    name: 'credit asset carries code and issuer together',
    why: 'An asset is the pair (code, issuer); the URI states both, so a wallet cannot pick the wrong USDC.',
    status: 'conformant',
    input: {
      destination: VALID_DESTINATION,
      amount: '120.1234567',
      asset: { code: 'USDC', issuer: VALID_ASSET_ISSUER },
    },
    expected: {
      kind: 'uri',
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=120.1234567&asset_code=USDC&asset_issuer=${VALID_ASSET_ISSUER}`,
      params: {
        destination: VALID_DESTINATION,
        amount: '120.1234567',
        asset_code: 'USDC',
        asset_issuer: VALID_ASSET_ISSUER,
      },
    },
  },
  {
    name: 'one stroop is representable',
    why: 'Seven decimals is the smallest unit the protocol has; the formatter passes it through unchanged.',
    status: 'conformant',
    input: { destination: VALID_DESTINATION, amount: '0.0000001' },
    expected: {
      kind: 'uri',
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=0.0000001`,
      params: { destination: VALID_DESTINATION, amount: '0.0000001' },
    },
  },
  {
    name: 'memo at the 28-byte ceiling',
    why: 'The boundary is inclusive: 28 bytes is accepted by Memo.text, and the URI carries the whole memo.',
    status: 'conformant',
    input: { destination: VALID_DESTINATION, amount: '25', memo: MEMO_28_BYTES },
    expected: {
      kind: 'uri',
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=25&memo=${MEMO_28_BYTES}&memo_type=MEMO_TEXT`,
      params: {
        destination: VALID_DESTINATION,
        amount: '25',
        memo: MEMO_28_BYTES,
        memo_type: 'MEMO_TEXT',
      },
    },
  },
  {
    name: 'an amount with eight decimals is emitted anyway',
    why: 'Stellar amounts have seven decimals. The SDK refuses this string when the payment is built; the URI carries it to the wallet regardless.',
    status: 'gap',
    followUp: 'Refuse more than seven decimals at the formatter, with the reason, rather than deferring to the wallet.',
    input: { destination: VALID_DESTINATION, amount: '1.12345678' },
    expected: {
      kind: 'uri',
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=1.12345678`,
      params: { destination: VALID_DESTINATION, amount: '1.12345678' },
    },
  },
  {
    name: 'a memo over 28 bytes is emitted anyway',
    why: 'Memo.text rejects anything past 28 bytes, so this URI can only fail after the payer has scanned and chosen to pay.',
    status: 'gap',
    followUp: 'Refuse a memo over 28 bytes, counted in bytes rather than characters.',
    input: { destination: VALID_DESTINATION, amount: '25', memo: MEMO_32_BYTES },
    expected: {
      kind: 'uri',
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=25&memo=${MEMO_32_BYTES}&memo_type=MEMO_TEXT`,
      params: {
        destination: VALID_DESTINATION,
        amount: '25',
        memo: MEMO_32_BYTES,
        memo_type: 'MEMO_TEXT',
      },
    },
  },
  {
    name: 'a non-ASCII memo over the byte ceiling is emitted anyway',
    why: 'The ceiling counts bytes: ten coffee cups are ten characters and thirty bytes, and Memo.text refuses them.',
    status: 'gap',
    followUp: 'Same rule as above, counted in bytes. Percent-encoding makes the URI look longer than the memo, which is a separate reason to check before encoding.',
    input: { destination: VALID_DESTINATION, amount: '25', memo: MEMO_30_BYTES_NON_ASCII },
    expected: {
      kind: 'uri',
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=25&memo=${encodeURIComponent(MEMO_30_BYTES_NON_ASCII)}&memo_type=MEMO_TEXT`,
      params: {
        destination: VALID_DESTINATION,
        amount: '25',
        memo: MEMO_30_BYTES_NON_ASCII,
        memo_type: 'MEMO_TEXT',
      },
    },
  },
  {
    name: 'XLM with an issuer is silently downgraded to a native payment',
    why: 'Invoice creation refuses this pair outright. The formatter accepts it and drops the issuer, which turns a credit asset into a native payment without saying so.',
    status: 'gap',
    followUp: 'Throw for a native code carrying an issuer, mirroring the rule in createInvoiceSchema.',
    input: {
      destination: VALID_DESTINATION,
      amount: '25',
      asset: { code: 'XLM', issuer: VALID_ASSET_ISSUER },
    },
    expected: {
      kind: 'uri',
      uri: `web+stellar:pay?destination=${VALID_DESTINATION}&amount=25`,
      params: { destination: VALID_DESTINATION, amount: '25' },
    },
  },
  {
    name: 'a muxed account destination is refused',
    why: 'SEP-0007 accepts an account ID or a payment address. Keypair.fromPublicKey only understands the first, so a valid M... destination cannot be paid by QR.',
    status: 'gap',
    followUp: 'Resolve the destination through StrKey (G or M) instead of Keypair.fromPublicKey.',
    input: { destination: MUXED_DESTINATION, amount: '25' },
    expected: { kind: 'throws', message: 'destination must be a valid Stellar public key' },
  },
  {
    name: 'a credit asset with no issuer is refused',
    why: 'An unpinned asset names nothing in particular, so the formatter declines to build a URI for it.',
    status: 'conformant',
    input: { destination: VALID_DESTINATION, amount: '25', asset: { code: 'USDC' } },
    expected: { kind: 'throws', message: 'asset issuer is required for USDC' },
  },
  {
    name: 'a malformed amount is refused',
    why: 'Exponent notation is not a Stellar amount, and the formatter rejects it before anything reaches a wallet.',
    status: 'conformant',
    input: { destination: VALID_DESTINATION, amount: '1e3' },
    expected: { kind: 'throws', message: 'amount must be a positive number' },
  },
];

