// Fixture data shared by the pending invoice filter unit tests.
//
// Each fixture is a (name, invoice, expectedResult) tuple.
// Names are kept descriptive so assertion messages read like a contract.

export interface PendingFilterCase {
  name: string;
  invoice: unknown;
  expectedResult: boolean;
}

export const VALID_PENDING_CASES: PendingFilterCase[] = [
  {
    name: 'standard pending stats invoice',
    invoice: {
      sellerPublicKey: 'GB2Q37P7G64ED5S7L6E2QJ4VYZJ77BXXQO2R6B66S2M56Q65J6D5K67L',
      amount: 100,
      assetCode: 'XLM',
      status: 'PENDING',
    },
    expectedResult: true,
  },
  {
    name: 'minimal pending object with status property only',
    invoice: { status: 'PENDING' },
    expectedResult: true,
  },
  {
    name: 'full stored invoice with pending status',
    invoice: {
      id: 'e16b69d8-08f6-49b6-8591-4ff43ae5a661',
      sellerPublicKey: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7',
      amount: 50.5,
      assetCode: 'USDC',
      assetIssuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
      memo: 'INV-TEST-1234',
      status: 'PENDING',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      expiresAt: new Date('2026-01-08T00:00:00Z'),
    },
    expectedResult: true,
  },
];

export const NON_PENDING_CASES: PendingFilterCase[] = [
  {
    name: 'paid status invoice',
    invoice: { status: 'PAID' },
    expectedResult: false,
  },
  {
    name: 'expired status invoice',
    invoice: { status: 'EXPIRED' },
    expectedResult: false,
  },
  {
    name: 'cancelled status invoice',
    invoice: { status: 'CANCELLED' },
    expectedResult: false,
  },
  {
    name: 'lowercase pending status is rejected',
    invoice: { status: 'pending' },
    expectedResult: false,
  },
  {
    name: 'mixed-case pending status is rejected',
    invoice: { status: 'Pending' },
    expectedResult: false,
  },
  {
    name: 'unknown status string is rejected',
    invoice: { status: 'UNKNOWN' },
    expectedResult: false,
  },
  {
    name: 'empty status string is rejected',
    invoice: { status: '' },
    expectedResult: false,
  },
];

export const MALFORMED_INVOICE_CASES: PendingFilterCase[] = [
  {
    name: 'null invoice is rejected',
    invoice: null,
    expectedResult: false,
  },
  {
    name: 'undefined invoice is rejected',
    invoice: undefined,
    expectedResult: false,
  },
  {
    name: 'empty object without status is rejected',
    invoice: {},
    expectedResult: false,
  },
  {
    name: 'invoice with null status is rejected',
    invoice: { status: null },
    expectedResult: false,
  },
  {
    name: 'invoice with undefined status is rejected',
    invoice: { status: undefined },
    expectedResult: false,
  },
  {
    name: 'invoice with numeric status is rejected',
    invoice: { status: 1 },
    expectedResult: false,
  },
  {
    name: 'invoice with boolean status is rejected',
    invoice: { status: true },
    expectedResult: false,
  },
  {
    name: 'raw string instead of invoice object is rejected',
    invoice: 'PENDING',
    expectedResult: false,
  },
  {
    name: 'raw number instead of invoice object is rejected',
    invoice: 12345,
    expectedResult: false,
  },
  {
    name: 'raw boolean instead of invoice object is rejected',
    invoice: true,
    expectedResult: false,
  },
  {
    name: 'array of invoices instead of single invoice is rejected',
    invoice: [{ status: 'PENDING' }],
    expectedResult: false,
  },
];

export default {
  VALID_PENDING_CASES,
  NON_PENDING_CASES,
  MALFORMED_INVOICE_CASES,
};
