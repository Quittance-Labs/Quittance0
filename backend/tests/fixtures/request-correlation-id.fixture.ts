export interface RequestCorrelationIdFixture {
  prefix?: string;
  size?: number;
  expectedPrefix: string;
  expectedMinLength: number;
}

export const VALID_CONFIG_FIXTURES: RequestCorrelationIdFixture[] = [
  {
    expectedPrefix: 'req_',
    expectedMinLength: 16, // 'req_' (4) + 12
  },
  {
    prefix: 'api_',
    size: 8,
    expectedPrefix: 'api_',
    expectedMinLength: 12, // 'api_' (4) + 8
  },
  {
    prefix: 'test_corr_',
    size: 16,
    expectedPrefix: 'test_corr_',
    expectedMinLength: 26, // 'test_corr_' (10) + 16
  },
];

export const INVALID_ID_CANDIDATES: unknown[] = [
  '',
  '   ',
  null,
  undefined,
  12345,
  {},
  [],
  'wrong_prefix_12345',
  'req', // missing underscore and suffix
  'req_', // empty random portion
];

export const VALID_ID_CANDIDATES: { id: string; prefix?: string; valid: boolean }[] = [
  { id: 'req_a1b2c3d4e5f6', prefix: 'req_', valid: true },
  { id: 'req_000000000000', prefix: 'req_', valid: true },
  { id: 'inv_trace_xyz9876', prefix: 'inv_trace_', valid: true },
  { id: 'other_123', prefix: 'req_', valid: false },
];
