import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  generateInvoiceMemo,
  generateShortReference,
  getMemoByteLength,
  hasInvoiceMemoPrefix,
  isMemoByteLengthValid,
  isTextMemoType,
  isValidMemo,
  normalizeMemo,
  INVOICE_MEMO_PREFIX,
  MEMO_ALPHABET,
  MEMO_FORMAT_PATTERN,
  STELLAR_MAX_MEMO_BYTES,
} from '../src/utils/memo.ts';

describe('memo contract constants', () => {
  it('enforces a 28-byte maximum for Stellar text memos', () => {
    assert.equal(STELLAR_MAX_MEMO_BYTES, 28);
  });

  it('uses the canonical INV- invoice prefix', () => {
    assert.equal(INVOICE_MEMO_PREFIX, 'INV-');
  });

  it('restricts the random alphabet to uppercase alphanumeric characters', () => {
    assert.match(MEMO_ALPHABET, /^[0-9A-Z]+$/);
    assert.equal(MEMO_ALPHABET.includes('-'), false);
    assert.equal(MEMO_ALPHABET.includes('_'), false);
  });
});

describe('getMemoByteLength and isMemoByteLengthValid', () => {
  it('computes byte length in UTF-8 correctly', () => {
    assert.equal(getMemoByteLength(''), 0);
    assert.equal(getMemoByteLength('hello'), 5);
    assert.equal(getMemoByteLength('é'), 2);
    assert.equal(getMemoByteLength('🚀'), 4);
  });

  it('validates memo byte length cap of 28 bytes', () => {
    assert.equal(isMemoByteLengthValid(''), true);
    assert.equal(isMemoByteLengthValid('A'.repeat(28)), true);
    assert.equal(isMemoByteLengthValid('A'.repeat(29)), false);
    assert.equal(isMemoByteLengthValid('é'.repeat(14)), true);
    assert.equal(isMemoByteLengthValid('é'.repeat(15)), false);
    assert.equal(isMemoByteLengthValid(null as any), false);
    assert.equal(isMemoByteLengthValid(undefined as any), false);
    assert.equal(isMemoByteLengthValid(123 as any), false);
  });
});

describe('normalizeMemo', () => {
  it('trims leading and trailing whitespace', () => {
    assert.equal(normalizeMemo('  INV-TEST-123  '), 'INV-TEST-123');
    assert.equal(normalizeMemo(''), '');
    assert.equal(normalizeMemo(undefined as any), '');
  });
});

describe('isTextMemoType', () => {
  it('accepts text memo types case-insensitively', () => {
    assert.equal(isTextMemoType('text'), true);
    assert.equal(isTextMemoType('TEXT'), true);
    assert.equal(isTextMemoType('memo_text'), true);
    assert.equal(isTextMemoType('MEMO_TEXT'), true);
  });

  it('rejects non-text memo types', () => {
    assert.equal(isTextMemoType('id'), false);
    assert.equal(isTextMemoType('memo_id'), false);
    assert.equal(isTextMemoType('hash'), false);
    assert.equal(isTextMemoType('memo_hash'), false);
    assert.equal(isTextMemoType('return'), false);
    assert.equal(isTextMemoType('memo_return'), false);
    assert.equal(isTextMemoType('none'), false);
    assert.equal(isTextMemoType(undefined), false);
    assert.equal(isTextMemoType(null), false);
    assert.equal(isTextMemoType(''), false);
  });
});

describe('isValidMemo format and bounds', () => {
  it('accepts valid invoice memos', () => {
    assert.equal(isValidMemo('INV-ABCD-1234'), true);
    assert.equal(isValidMemo('INV-1-A'), true);
  });

  it('rejects memos exceeding 28 UTF-8 bytes', () => {
    const longMemo = 'INV-12345678901234567890123456';
    assert.equal(Buffer.byteLength(longMemo, 'utf8') > 28, true);
    assert.equal(isValidMemo(longMemo), false);
  });

  it('rejects memos without the INV- prefix', () => {
    assert.equal(isValidMemo('TEST-ABCD-1234'), false);
    assert.equal(isValidMemo('ABCD-1234'), false);
    assert.equal(isValidMemo('INVABCD1234'), false);
  });

  it('rejects memos containing lowercase characters', () => {
    assert.equal(isValidMemo('INV-abcd-1234'), false);
    assert.equal(isValidMemo('inv-ABCD-1234'), false);
  });

  it('rejects memos with hyphens in the random tail', () => {
    assert.equal(isValidMemo('INV-ABCD-12-34'), false);
    assert.equal(isValidMemo('INV-AB-CD-1234'), false);
  });

  it('rejects memos with special symbols or whitespace', () => {
    assert.equal(isValidMemo('INV-ABCD-12_34'), false);
    assert.equal(isValidMemo('INV-ABCD-12 34'), false);
    assert.equal(isValidMemo('INV-ABCD-12$34'), false);
  });
});

describe('generateInvoiceMemo and generateShortReference contract', () => {
  it('generates 1000 memos satisfying all invariants: format, prefix, charset, uniqueness, and <= 28 bytes', () => {
    const memos = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      const memo = generateInvoiceMemo();
      assert.equal(isValidMemo(memo), true);
      assert.equal(hasInvoiceMemoPrefix(memo), true);
      assert.equal(isMemoByteLengthValid(memo), true);
      assert.equal(Buffer.byteLength(memo, 'utf8') <= 28, true);
      assert.match(memo, MEMO_FORMAT_PATTERN);
      memos.add(memo);
    }
    assert.equal(memos.size, 1000);
  });

  it('generates short references within the memo character set and 28-byte boundary', () => {
    for (let index = 0; index < 100; index += 1) {
      const ref = generateShortReference();
      assert.equal(ref.length, 10);
      assert.match(ref, /^[0-9A-Z]+$/);
      assert.equal(isMemoByteLengthValid(ref), true);
    }
  });
});
