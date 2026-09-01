import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequestId,
  isValidRequestId,
  parseRequestId,
  REQUEST_ID_BYTES,
  REQUEST_ID_PREFIX,
} from '../src/utils/request-correlation-id';
import {
  FORMAT_CASES,
  UNIQUENESS_CONFIG,
  PROPERTY_CASES,
  VALIDATION_CASES,
  PARSE_CASES,
} from './fixtures/request-correlation-id.fixture';

describe('REQUEST_ID constants', () => {
  it('uses 8 bytes for 64 bits of entropy by default', () => {
    assert.equal(REQUEST_ID_BYTES, 8);
  });

  it('default prefix is "req"', () => {
    assert.equal(REQUEST_ID_PREFIX, 'req');
  });
});

describe('createRequestId — format properties (contract fixtures)', () => {
  const sampleId = createRequestId();

  it(FORMAT_CASES[0].name, () => {
    assert.ok(sampleId.startsWith('req-'));
  });

  it(FORMAT_CASES[1].name, () => {
    const hexPart = sampleId.slice(4);
    assert.equal(hexPart.length, 16);
  });

  it(FORMAT_CASES[2].name, () => {
    const hexPart = sampleId.slice(4);
    assert.ok(/^[0-9a-f]+$/.test(hexPart));
  });

  it(FORMAT_CASES[3].name, () => {
    assert.equal(sampleId.length, 20);
  });
});

describe('createRequestId — property cases', () => {
  const id = createRequestId();

  for (const propertyCase of PROPERTY_CASES) {
    it(propertyCase.name, () => {
      assert.equal(propertyCase.test(id), propertyCase.expectedResult);
    });
  }
});

describe('isValidRequestId — validation test cases', () => {
  for (const validationCase of VALIDATION_CASES) {
    it(validationCase.name, () => {
      const result = isValidRequestId(validationCase.input, validationCase.prefix);
      assert.equal(result, validationCase.expectedValid);
    });
  }
});

describe('parseRequestId — parsing test cases', () => {
  for (const parseCase of PARSE_CASES) {
    it(parseCase.name, () => {
      const result = parseRequestId(parseCase.input);
      assert.deepEqual(result, parseCase.expected);
    });
  }
});

describe('createRequestId — uniqueness', () => {
  it(UNIQUENESS_CONFIG.description, () => {
    const ids = new Set<string>();
    for (let i = 0; i < UNIQUENESS_CONFIG.sampleSize; i++) {
      ids.add(createRequestId());
    }
    assert.equal(ids.size, UNIQUENESS_CONFIG.sampleSize);
  });
});

describe('createRequestId — direct edge cases', () => {
  it('returns a string on every call', () => {
    for (let i = 0; i < 100; i++) {
      assert.equal(typeof createRequestId(), 'string');
    }
  });

  it('consecutive calls produce distinct IDs', () => {
    const first = createRequestId();
    const second = createRequestId();
    assert.notEqual(first, second);
  });

  it('matches canonical regex pattern across 1000 samples', () => {
    for (let i = 0; i < 1000; i++) {
      const id = createRequestId();
      assert.ok(/^req-[0-9a-f]{16}$/.test(id), `Generated ID ${id} did not match pattern`);
    }
  });

  it('supports custom prefix when specified', () => {
    const customId = createRequestId('invoice');
    assert.ok(customId.startsWith('invoice-'));
    const hexPart = customId.slice('invoice-'.length);
    assert.equal(hexPart.length, 16);
    assert.ok(/^[0-9a-f]+$/.test(hexPart));
  });

  it('supports custom byteLength when specified', () => {
    const customLengthId = createRequestId('req', 16);
    assert.ok(customLengthId.startsWith('req-'));
    const hexPart = customLengthId.slice(4);
    assert.equal(hexPart.length, 32);
    assert.ok(/^[0-9a-f]+$/.test(hexPart));
  });

  it('falls back to default byteLength when non-positive byteLength is provided', () => {
    const idWithZero = createRequestId('req', 0);
    assert.equal(idWithZero.length, 20);
    const idWithNegative = createRequestId('req', -5);
    assert.equal(idWithNegative.length, 20);
    const idWithFloat = createRequestId('req', 3.14 as any);
    assert.equal(idWithFloat.length, 20);
  });

  it('falls back to default prefix when empty or non-string prefix is provided', () => {
    const idWithEmpty = createRequestId('');
    assert.ok(idWithEmpty.startsWith('req-'));
    const idWithSpaces = createRequestId('   ');
    assert.ok(idWithSpaces.startsWith('req-'));
  });
});

export default createRequestId;
