// Fixture data shared by the request correlation ID unit tests.

export interface RequestIdFormatCase {
  name: string;
}

export const FORMAT_CASES: RequestIdFormatCase[] = [
  { name: 'starts with req- prefix' },
  { name: 'hex part is 16 characters long' },
  { name: 'hex part contains only lowercase hex digits' },
  { name: 'total length is 20 characters (req- + 16 hex)' },
];

export const UNIQUENESS_CONFIG = {
  sampleSize: 1000,
  description: '1000 generated IDs must all be unique',
};

export interface PropertyCase {
  name: string;
  test: (id: string) => boolean;
  expectedResult: boolean;
}

export const PROPERTY_CASES: PropertyCase[] = [
  {
    name: 'ID matches regex /^req-[0-9a-f]{16}$/',
    test: (id: string) => /^req-[0-9a-f]{16}$/.test(id),
    expectedResult: true,
  },
  {
    name: 'ID is a string type',
    test: (id: string) => typeof id === 'string',
    expectedResult: true,
  },
  {
    name: 'ID has non-zero length',
    test: (id: string) => id.length > 0,
    expectedResult: true,
  },
];

export interface ValidationTestCase {
  name: string;
  input: unknown;
  prefix?: string;
  expectedValid: boolean;
}

export const VALIDATION_CASES: ValidationTestCase[] = [
  {
    name: 'valid standard request ID with req prefix',
    input: 'req-0123456789abcdef',
    expectedValid: true,
  },
  {
    name: 'valid standard request ID with uppercase hex digits',
    input: 'req-0123456789ABCDEF',
    expectedValid: true,
  },
  {
    name: 'valid longer entropy request ID',
    input: 'req-0123456789abcdef0123456789abcdef',
    expectedValid: true,
  },
  {
    name: 'valid custom prefix request ID',
    input: 'inv-0123456789abcdef',
    prefix: 'inv',
    expectedValid: true,
  },
  {
    name: 'rejects missing prefix separator',
    input: 'req0123456789abcdef',
    expectedValid: false,
  },
  {
    name: 'rejects wrong prefix',
    input: 'inv-0123456789abcdef',
    prefix: 'req',
    expectedValid: false,
  },
  {
    name: 'rejects too short hex part',
    input: 'req-12345',
    expectedValid: false,
  },
  {
    name: 'rejects non-hex characters',
    input: 'req-0123456789ghijk0',
    expectedValid: false,
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
    name: 'rejects numbers',
    input: 1234567890,
    expectedValid: false,
  },
  {
    name: 'rejects object',
    input: { id: 'req-0123456789abcdef' },
    expectedValid: false,
  },
];

export interface ParseTestCase {
  name: string;
  input: unknown;
  expected: { prefix: string; hex: string } | null;
}

export const PARSE_CASES: ParseTestCase[] = [
  {
    name: 'parses standard request ID',
    input: 'req-0123456789abcdef',
    expected: { prefix: 'req', hex: '0123456789abcdef' },
  },
  {
    name: 'parses uppercase hex and normalizes to lowercase',
    input: 'req-ABCDEF0123456789',
    expected: { prefix: 'req', hex: 'abcdef0123456789' },
  },
  {
    name: 'parses custom prefix ID',
    input: 'trace-a1b2c3d4e5f60718',
    expected: { prefix: 'trace', hex: 'a1b2c3d4e5f60718' },
  },
  {
    name: 'returns null for missing hyphen',
    input: 'req0123456789abcdef',
    expected: null,
  },
  {
    name: 'returns null for non-hex characters',
    input: 'req-invalid_hex_string',
    expected: null,
  },
  {
    name: 'returns null for non-string input',
    input: 12345,
    expected: null,
  },
];

export default {
  FORMAT_CASES,
  UNIQUENESS_CONFIG,
  PROPERTY_CASES,
  VALIDATION_CASES,
  PARSE_CASES,
};
