// Fixture data shared by the pending invoice stats filter tests.

import type { StatsInvoice } from '../../src/storage/invoice-stats';

export const PENDING_INVOICE: StatsInvoice = {
  sellerPublicKey: 'GAV5XS3IZFW5O677MRHOBKL74UASTVURZQMW5TQLQVXKLKX4QCJQ2JHJ',
  amount: 100,
  assetCode: 'XLM',
  status: 'PENDING',
};

export const PAID_INVOICE: StatsInvoice = {
  sellerPublicKey: 'GAV5XS3IZFW5O677MRHOBKL74UASTVURZQMW5TQLQVXKLKX4QCJQ2JHJ',
  amount: 200,
  assetCode: 'USDC',
  status: 'PAID',
};

export const EXPIRED_INVOICE: StatsInvoice = {
  sellerPublicKey: 'GAV5XS3IZFW5O677MRHOBKL74UASTVURZQMW5TQLQVXKLKX4QCJQ2JHJ',
  amount: 50,
  assetCode: 'XLM',
  status: 'EXPIRED',
};

export const CANCELLED_INVOICE: StatsInvoice = {
  sellerPublicKey: 'GAV5XS3IZFW5O677MRHOBKL74UASTVURZQMW5TQLQVXKLKX4QCJQ2JHJ',
  amount: 75,
  assetCode: 'XLM',
  status: 'CANCELLED',
};

export const PENDING_CASES = [
  { name: 'pending status', invoice: PENDING_INVOICE, expected: true },
  { name: 'paid status', invoice: PAID_INVOICE, expected: false },
  { name: 'expired status', invoice: EXPIRED_INVOICE, expected: false },
  { name: 'cancelled status', invoice: CANCELLED_INVOICE, expected: false },
];

export const EDGE_CASES = [
  {
    name: 'unknown status is not pending',
    invoice: { ...PENDING_INVOICE, status: 'UNKNOWN' as StatsInvoice['status'] },
    expected: false,
  },
  {
    name: 'empty status is not pending',
    invoice: { ...PENDING_INVOICE, status: '' as StatsInvoice['status'] },
    expected: false,
  },
];
