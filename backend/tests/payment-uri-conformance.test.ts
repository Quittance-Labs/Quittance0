/**
 * SEP-0007 payment URI conformance suite (issue #382).
 *
 * This suite does two jobs, and they are worth separating:
 *
 * 1. Pin the URI the product emits today, so the follow-up formatter change the
 *    issue asks for has a diff to show and a reason for every line it moves.
 * 2. Prove the documented gaps are real, using this repository's own Stellar SDK
 *    as the authority rather than a description of it. A gap is only worth
 *    writing down if the SDK or the spec actually refuses what we emit.
 *
 * Neither job needs a wallet: every refusal asserted here comes from
 * `@stellar/stellar-sdk`, which is what any wallet builds the payment with.
 * What a specific wallet does with a URI it cannot satisfy (LOBSTR, Freighter,
 * xBull) is a manual check, and docs/PAYMENT-URI.md lists exactly what to check.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Asset, Keypair, Memo, Operation, StrKey } from '@stellar/stellar-sdk';
import { formatQrPaymentPayload } from '../src/utils/qr-payment-payload';
import { VALID_DESTINATION } from './fixtures/qr-payment-payload.fixture';
import {
  MEMO_28_BYTES,
  MEMO_30_BYTES_NON_ASCII,
  MEMO_32_BYTES,
  MUXED_DESTINATION,
  PAYMENT_URI_CASES,
} from './fixtures/payment-uri-cases.fixture';

const GAPS = PAYMENT_URI_CASES.filter((c) => c.status === 'gap');
const CONFORMANT = PAYMENT_URI_CASES.filter((c) => c.status === 'conformant');

describe('payment URI — what the formatter emits today', () => {
  for (const c of PAYMENT_URI_CASES) {
    it(c.name, () => {
      if (c.expected.kind === 'throws') {
        assert.throws(() => formatQrPaymentPayload(c.input), { message: c.expected.message });
        return;
      }

      const result = formatQrPaymentPayload(c.input);
      assert.equal(result.uri, c.expected.uri);
      assert.deepEqual(result.params, c.expected.params);
    });
  }
});

describe('payment URI — the gaps, proven against the SDK', () => {
  it('refuses an amount the SDK would not build a payment from', () => {
    // Formerly the eighth decimal was emitted anyway and the SDK refused it at
    // payment-build time. The formatter now refuses first, so nothing beyond
    // the compared stroops ever reaches a wallet.
    assert.throws(
      () => formatQrPaymentPayload({ destination: VALID_DESTINATION, amount: '1.12345678' }),
      /at most 7 decimal places/
    );

    assert.throws(
      () =>
        Operation.payment({
          destination: VALID_DESTINATION,
          asset: Asset.native(),
          amount: '1.12345678',
        }),
      /at most 7 digits after the decimal/,
      'the ceiling is seven decimals; the SDK agrees'
    );
  });

  it('refuses a memo the SDK will not attach to a transaction', () => {
    assert.throws(
      () =>
        formatQrPaymentPayload({
          destination: VALID_DESTINATION,
          amount: '25',
          memo: MEMO_32_BYTES,
        }),
      /28-byte/,
      'the formatter refuses before the SDK is ever reached'
    );

    assert.throws(() => Memo.text(MEMO_32_BYTES), /max 28 bytes/);
  });

  it('counts the memo ceiling in bytes, and refuses an over-limit non-ASCII memo', () => {
    assert.equal(MEMO_30_BYTES_NON_ASCII.length, 10, 'ten characters');
    assert.equal(Buffer.byteLength(MEMO_30_BYTES_NON_ASCII), 30, 'thirty bytes');

    assert.throws(
      () =>
        formatQrPaymentPayload({
          destination: VALID_DESTINATION,
          amount: '25',
          memo: MEMO_30_BYTES_NON_ASCII,
        }),
      /28-byte/
    );
    assert.throws(() => Memo.text(MEMO_30_BYTES_NON_ASCII), /max 28 bytes/);
  });

  it('accepts the memo at the ceiling, so the boundary is where it is documented to be', () => {
    assert.equal(Buffer.byteLength(MEMO_28_BYTES), 28);
    assert.doesNotThrow(() => Memo.text(MEMO_28_BYTES));
  });

  it('refuses a destination the spec calls valid', () => {
    assert.ok(StrKey.isValidMed25519PublicKey(MUXED_DESTINATION), 'a valid payment address');
    assert.throws(() => Keypair.fromPublicKey(MUXED_DESTINATION));
  });

  it('refuses an XLM-labelled credit asset instead of replacing it with native XLM', () => {
    const credit = new Asset('XLM', VALID_DESTINATION);
    assert.equal(credit.isNative(), false);
    assert.equal(credit.getIssuer(), VALID_DESTINATION);
    assert.throws(() => formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '25',
      asset: { code: 'XLM', issuer: VALID_DESTINATION },
    }), /XLM is the native asset and must not carry an issuer/);
  });
});

describe('payment URI — keeping the gap list honest', () => {
  it('records a follow-up for every gap', () => {
    for (const c of GAPS) {
      assert.ok(c.followUp && c.followUp.length > 0, `${c.name} is a gap with no follow-up`);
    }
  });

  it('records none for the cases that already conform', () => {
    for (const c of CONFORMANT) {
      assert.equal(c.followUp, undefined, `${c.name} conforms but carries a follow-up`);
    }
  });

  it('holds one remaining gap, so adding or closing one is a deliberate edit', () => {
    assert.deepEqual(
      GAPS.map((c) => c.name),
      [
        'a muxed account destination is refused',
      ],
      'the gap list changed: update docs/PAYMENT-URI.md in the same commit'
    );
  });
});
