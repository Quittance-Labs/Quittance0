// Fixture data shared by the pending-invoice classification unit tests.
//
// Each fixture is a (name, invoice, expectedResult) case. Names are kept
// descriptive so assertion messages read like a contract.

import type { PendingCheckableInvoice } from '../../src/utils/stats-pending-filter';

export interface PendingInvoiceCase {
  name: string;
  invoice: PendingCheckableInvoice | null | undefined;
  expectedResult: boolean;
}

export const PENDING_INVOICE_CASES: PendingInvoiceCase[] = [
  {
    name: 'PENDING status is classified as pending',
    invoice: { status: 'PENDING' },
    expectedResult: true,
  },
  {
    name: 'PAID status is not classified as pending',
    invoice: { status: 'PAID' },
    expectedResult: false,
  },
  {
    name: 'EXPIRED status is not classified as pending',
    invoice: { status: 'EXPIRED' },
    expectedResult: false,
  },
  {
    name: 'CANCELLED status is not classified as pending',
    invoice: { status: 'CANCELLED' },
    expectedResult: false,
  },
  {
    name: 'unknown/unrecognized status is not classified as pending',
    invoice: { status: 'REFUNDED' },
    expectedResult: false,
  },
  {
    name: 'empty string status is not classified as pending',
    invoice: { status: '' },
    expectedResult: false,
  },
  {
    name: 'missing status field is not classified as pending',
    invoice: {},
    expectedResult: false,
  },
  {
    name: 'null status is not classified as pending',
    invoice: { status: null },
    expectedResult: false,
  },
  {
    name: 'lowercase "pending" does not match the exact-case PENDING literal',
    invoice: { status: 'pending' },
    expectedResult: false,
  },
  {
    name: 'status with surrounding whitespace does not match',
    invoice: { status: ' PENDING ' },
    expectedResult: false,
  },
  {
    name: 'null invoice is not classified as pending',
    invoice: null,
    expectedResult: false,
  },
  {
    name: 'undefined invoice is not classified as pending',
    invoice: undefined,
    expectedResult: false,
  },
];

export default { PENDING_INVOICE_CASES };
