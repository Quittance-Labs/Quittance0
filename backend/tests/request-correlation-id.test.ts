import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequestId,
  REQUEST_ID_BYTES,
  REQUEST_ID_PREFIX,
} from '../src/utils/request-correlation-id';
import {
  FORMAT_CASES,
  UNIQUENESS_CASES,
  PROPERTY_CASES,
} from './fixtures/request-correlation-id.fixture';

describe('REQUEST_ID constants', () => {
  it('uses 8 bytes for 64 bits of entropy', () => {
    assert.equal(REQUEST_ID_BYTES, 8);
  });

  it('prefix is "req"', () => {
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

  for (const c of PROPERTY_CASES) {
    it(c.name, () => {
      assert.equal(c.test(id), c.expectedResult);
    });
  }
});

describe('createRequestId — uniqueness', () => {
  it(UNIQUENESS_CASES.description, () => {
    const ids = new Set<string>();
    for (let i = 0; i < UNIQUENESS_CASES.sampleSize; i++) {
      ids.add(createRequestId());
    }
    assert.equal(ids.size, UNIQUENESS_CASES.sampleSize);
  });
});

describe('createRequestId — direct edge cases', () => {
  it('returns a string every time', () => {
    for (let i = 0; i < 100; i++) {
      assert.equal(typeof createRequestId(), 'string');
    }
  });

  it('two consecutive calls produce different ids', () => {
    const a = createRequestId();
    const b = createRequestId();
    assert.notEqual(a, b);
  });

  it('matches the canonical regex on 1000 samples', () => {
    for (let i = 0; i < 1000; i++) {
      const id = createRequestId();
      assert.ok(/^req-[0-9a-f]{16}$/.test(id), `id ${id} did not match regex`);
    }
  });
});

export default createRequestId;
