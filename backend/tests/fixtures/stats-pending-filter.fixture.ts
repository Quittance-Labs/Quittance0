export const PENDING_INVOICE_FIXTURE = [
  { name: 'pending', invoice: { status: 'PENDING' }, expected: true },
  { name: 'paid', invoice: { status: 'PAID' }, expected: false },
  { name: 'expired', invoice: { status: 'EXPIRED' }, expected: false },
  { name: 'cancelled', invoice: { status: 'CANCELLED' }, expected: false },
  { name: 'null', invoice: null, expected: false },
  { name: 'undefined', invoice: undefined, expected: false },
] as const;
