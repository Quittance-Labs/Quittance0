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
  it('emits an amount the SDK will not build a payment from', () => {
    const result = formatQrPaymentPayload({ destination: VALID_DESTINATION, amount: '1.12345678' });
    assert.match(result.uri, /amount=1\.12345678/);

    assert.throws(
      () =>
        Operation.payment({
          destination: VALID_DESTINATION,
          asset: Asset.native(),
          amount: '1.12345678',
        }),
      /at most 7 digits after the decimal/,
      'the ceiling is seven decimals; the URI carries eight'
    );
  });

  it('emits a memo the SDK will not attach to a transaction', () => {
    const result = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '25',
      memo: MEMO_32_BYTES,
    });
    assert.ok(result.params.memo === MEMO_32_BYTES);

    assert.throws(() => Memo.text(MEMO_32_BYTES), /max 28 bytes/);
  });

  it('counts the memo ceiling in bytes, and emits an over-limit non-ASCII memo anyway', () => {
    const result = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '25',
      memo: MEMO_30_BYTES_NON_ASCII,
    });
    assert.equal(result.params.memo, MEMO_30_BYTES_NON_ASCII);

    assert.equal(MEMO_30_BYTES_NON_ASCII.length, 10, 'ten characters');
    assert.equal(Buffer.byteLength(MEMO_30_BYTES_NON_ASCII), 30, 'thirty bytes');
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

  it('drops the issuer from an XLM-labelled credit asset without saying so', () => {
    const result = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '25',
      asset: { code: 'XLM', issuer: VALID_DESTINATION },
    });

    assert.equal('asset_code' in result.params, false);
    assert.equal('asset_issuer' in result.params, false);
    assert.equal(result.uri, `web+stellar:pay?destination=${VALID_DESTINATION}&amount=25`);
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

  it('holds five gaps, so adding or closing one is a deliberate edit', () => {
    assert.deepEqual(
      GAPS.map((c) => c.name),
      [
        'an amount with eight decimals is emitted anyway',
        'a memo over 28 bytes is emitted anyway',
        'a non-ASCII memo over the byte ceiling is emitted anyway',
        'XLM with an issuer is silently downgraded to a native payment',
        'a muxed account destination is refused',
      ],
      'the gap list changed: update docs/PAYMENT-URI.md in the same commit'
    );
  });
});

