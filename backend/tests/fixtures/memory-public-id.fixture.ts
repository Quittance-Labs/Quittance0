// Fixture data shared by the memory public invoice ID unit tests.

export interface IdFormatCase {
  name: string;
}

export const FORMAT_CASES: IdFormatCase[] = [
  { name: 'length is exactly 36 characters' },
  { name: 'contains 4 hyphens at indices 8, 13, 18, and 23' },
  { name: 'version character at index 14 is 4' },
  { name: 'variant character at index 19 is one of 8, 9, a, b' },
  { name: 'all non-hyphen characters are valid hexadecimal digits' },
];

export const UNIQUENESS_CONFIG = {
  sampleSize: 1000,
  description: '1000 generated public invoice IDs must all be unique and valid',
};

export interface PropertyCase {
  name: string;
  test: (id: string) => boolean;
  expectedResult: boolean;
}

export const PROPERTY_CASES: PropertyCase[] = [
  {
    name: 'ID is a non-empty string',
    test: (id: string) => typeof id === 'string' && id.length === 36,
    expectedResult: true,
  },
  {
    name: 'ID matches canonical UUID v4 regex',
    test: (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
    expectedResult: true,
  },
  {
    name: 'ID splits into 5 hyphen-delimited segments with lengths 8, 4, 4, 4, 12',
    test: (id: string) => {
      const parts = id.split('-');
      return (
        parts.length === 5 &&
        parts[0].length === 8 &&
        parts[1].length === 4 &&
        parts[2].length === 4 &&
        parts[3].length === 4 &&
        parts[4].length === 12
      );
    },
    expectedResult: true,
  },
];

export interface ValidationTestCase {
  name: string;
  input: unknown;
  expectedValid: boolean;
}

export const VALIDATION_CASES: ValidationTestCase[] = [
  {
    name: 'valid canonical lowercase UUID v4',
    input: 'c56a4180-65aa-42ec-a945-5fd21dec0538',
    expectedValid: true,
  },
  {
    name: 'valid uppercase UUID v4',
    input: 'C56A4180-65AA-42EC-A945-5FD21DEC0538',
    expectedValid: true,
  },
  {
    name: 'valid mixed-case UUID v4',
    input: 'c56A4180-65Aa-42eC-a945-5fD21Dec0538',
    expectedValid: true,
  },
  {
    name: 'valid UUID with surrounding whitespace',
    input: '  c56a4180-65aa-42ec-a945-5fd21dec0538  ',
    expectedValid: true,
  },
  {
    name: 'rejects empty string',
    input: '',
    expectedValid: false,
  },
  {
    name: 'rejects whitespace string',
    input: '   ',
    expectedValid: false,
  },
  {
    name: 'rejects UUID missing hyphens',
    input: 'c56a418065aa42eca9455fd21dec0538',
    expectedValid: false,
  },
  {
    name: 'rejects UUID with wrong hyphen placement',
    input: 'c56a418-065aa-42ec-a945-5fd21dec0538',
    expectedValid: false,
  },
  {
    name: 'rejects UUID with invalid hex characters',
    input: 'g56a4180-65aa-42ec-a945-5fd21dec053z',
    expectedValid: false,
  },
  {
    name: 'rejects truncated UUID',
    input: 'c56a4180-65aa-42ec-a945',
    expectedValid: false,
  },
  {
    name: 'rejects oversized string with valid UUID prefix',
    input: 'c56a4180-65aa-42ec-a945-5fd21dec0538-extra',
    expectedValid: false,
  },
  {
    name: 'rejects null',
    input: null,
    expectedValid: false,
  },
  {
    name: 'rejects undefined',
    input: undefined,
    expectedValid: false,
  },
  {
    name: 'rejects number',
    input: 123456789,
    expectedValid: false,
  },
  {
    name: 'rejects boolean true',
    input: true,
    expectedValid: false,
  },
  {
    name: 'rejects object',
    input: { id: 'c56a4180-65aa-42ec-a945-5fd21dec0538' },
    expectedValid: false,
  },
  {
    name: 'rejects array',
    input: ['c56a4180-65aa-42ec-a945-5fd21dec0538'],
    expectedValid: false,
  },
];

export interface NormalizationTestCase {
  name: string;
  input: unknown;
  expected: string | null;
}

export const NORMALIZATION_CASES: NormalizationTestCase[] = [
  {
    name: 'normalizes uppercase UUID to lowercase',
    input: 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
    expected: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  },
  {
    name: 'trims whitespace from valid UUID',
    input: '  a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11  ',
    expected: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  },
  {
    name: 'preserves already normalized lowercase UUID',
    input: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    expected: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  },
  {
    name: 'returns null for invalid string',
    input: 'not-a-valid-uuid',
    expected: null,
  },
  {
    name: 'returns null for non-string input',
    input: 12345,
    expected: null,
  },
  {
    name: 'returns null for null',
    input: null,
    expected: null,
  },
  {
    name: 'returns null for undefined',
    input: undefined,
    expected: null,
  },
];

export default {
  FORMAT_CASES,
  UNIQUENESS_CONFIG,
  PROPERTY_CASES,
  VALIDATION_CASES,
  NORMALIZATION_CASES,
};
