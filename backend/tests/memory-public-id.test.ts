import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generatePublicInvoiceId,
  isValidPublicInvoiceId,
  normalizePublicInvoiceId,
  PUBLIC_INVOICE_ID_LENGTH,
  UUID_V4_REGEX,
} from '../src/utils/memory-public-id';
import {
  FORMAT_CASES,
  UNIQUENESS_CONFIG,
  PROPERTY_CASES,
  VALIDATION_CASES,
  NORMALIZATION_CASES,
} from './fixtures/memory-public-id.fixture';

describe('PUBLIC_INVOICE_ID constants', () => {
  it('defines the standard UUID length as 36 characters', () => {
    assert.equal(PUBLIC_INVOICE_ID_LENGTH, 36);
  });

  it('provides a valid UUID v4 regular expression', () => {
    assert.ok(UUID_V4_REGEX instanceof RegExp);
  });
});

describe('generatePublicInvoiceId — format properties (contract fixtures)', () => {
  const sampleId = generatePublicInvoiceId();

  it(FORMAT_CASES[0].name, () => {
    assert.equal(sampleId.length, 36);
  });

  it(FORMAT_CASES[1].name, () => {
    assert.equal(sampleId[8], '-');
    assert.equal(sampleId[13], '-');
    assert.equal(sampleId[18], '-');
    assert.equal(sampleId[23], '-');
  });

  it(FORMAT_CASES[2].name, () => {
    assert.equal(sampleId[14], '4');
  });

  it(FORMAT_CASES[3].name, () => {
    const variantChar = sampleId[19].toLowerCase();
    assert.ok(['8', '9', 'a', 'b'].includes(variantChar));
  });

  it(FORMAT_CASES[4].name, () => {
    const hexOnly = sampleId.replace(/-/g, '');
    assert.ok(/^[0-9a-fA-F]{32}$/.test(hexOnly));
  });
});

describe('generatePublicInvoiceId — property cases', () => {
  const id = generatePublicInvoiceId();

  for (const propertyCase of PROPERTY_CASES) {
    it(propertyCase.name, () => {
      assert.equal(propertyCase.test(id), propertyCase.expectedResult);
    });
  }
});

describe('isValidPublicInvoiceId — validation test cases', () => {
  for (const validationCase of VALIDATION_CASES) {
    it(validationCase.name, () => {
      const result = isValidPublicInvoiceId(validationCase.input);
      assert.equal(result, validationCase.expectedValid);
    });
  }
});

describe('normalizePublicInvoiceId — normalization test cases', () => {
  for (const normalizationCase of NORMALIZATION_CASES) {
    it(normalizationCase.name, () => {
      const result = normalizePublicInvoiceId(normalizationCase.input);
      assert.equal(result, normalizationCase.expected);
    });
  }
});

describe('generatePublicInvoiceId — uniqueness and entropy', () => {
  it(UNIQUENESS_CONFIG.description, () => {
    const ids = new Set<string>();
    for (let i = 0; i < UNIQUENESS_CONFIG.sampleSize; i++) {
      const id = generatePublicInvoiceId();
      assert.ok(isValidPublicInvoiceId(id), `Generated ID ${id} is not a valid UUID`);
      assert.ok(UUID_V4_REGEX.test(id), `Generated ID ${id} did not match UUID v4 regex`);
      ids.add(id);
    }
    assert.equal(ids.size, UNIQUENESS_CONFIG.sampleSize);
  });
});

describe('generatePublicInvoiceId — direct edge cases', () => {
  it('always returns a non-empty string', () => {
    for (let i = 0; i < 50; i++) {
      const id = generatePublicInvoiceId();
      assert.equal(typeof id, 'string');
      assert.equal(id.length, 36);
    }
  });

  it('consecutive calls produce distinct identifiers', () => {
    const first = generatePublicInvoiceId();
    const second = generatePublicInvoiceId();
    assert.notEqual(first, second);
  });
});

export default generatePublicInvoiceId;
