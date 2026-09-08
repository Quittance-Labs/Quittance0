// Fixture data shared by the request correlation id unit tests.

export interface RequestIdFormatCase {
  name: string;
}

export const FORMAT_CASES: RequestIdFormatCase[] = [
  { name: 'starts with req- prefix' },
  { name: 'hex part is 16 characters long' },
  { name: 'hex part contains only lowercase hex digits' },
  { name: 'total length is 20 characters (req- + 16 hex)' },
];

export const UNIQUENESS_CASES = {
  sampleSize: 1000,
  description: '1000 generated ids must all be unique',
};

export interface PropertyCase {
  name: string;
  test: (id: string) => boolean;
  expectedResult: boolean;
}

export const PROPERTY_CASES: PropertyCase[] = [
  {
    name: 'id matches regex /^req-[0-9a-f]{16}$/',
    test: (id) => /^req-[0-9a-f]{16}$/.test(id),
    expectedResult: true,
  },
  {
    name: 'id is a string type',
    test: (id) => typeof id === 'string',
    expectedResult: true,
  },
  {
    name: 'id has non-zero length',
    test: (id) => id.length > 0,
    expectedResult: true,
  },
];

export default { FORMAT_CASES, UNIQUENESS_CASES, PROPERTY_CASES };
