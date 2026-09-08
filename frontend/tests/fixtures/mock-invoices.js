/**
 * Test fixtures for isolated frontend unit tests.
 * These fixtures are not imported by or wired into production runtime.
 */

const mockInvoices = [
  {
    id: '1',
    amount: 100.50,
    assetCode: 'XLM',
    description: 'Web development services',
    customerName: 'Alice Smith',
    customerEmail: 'alice@example.com',
    status: 'PAID',
    memo: 'INV-DEMO-001',
    sellerPublicKey: 'GABC123EXAMPLE456',
    createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    paidAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    paymentTxHash: 'abc123def456ghi789',
    payerPublicKey: 'GXYZ789EXAMPLE123',
  },
  {
    id: '2',
    amount: 250.00,
    assetCode: 'XLM',
    description: 'Brand design',
    customerName: 'Bob Jones',
    status: 'PENDING',
    memo: 'INV-DEMO-002',
    sellerPublicKey: 'GABC123EXAMPLE456',
    createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '3',
    amount: 75.25,
    assetCode: 'XLM',
    description: 'Consulting retainer',
    customerName: 'Charlie Brown',
    status: 'PENDING',
    memo: 'INV-DEMO-003',
    sellerPublicKey: 'GABC123EXAMPLE456',
    createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 6.8 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '4',
    amount: 500.00,
    assetCode: 'USDC',
    description: 'Mobile app development',
    customerName: 'Diana Prince',
    status: 'EXPIRED',
    memo: 'INV-DEMO-004',
    sellerPublicKey: 'GABC123EXAMPLE456',
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

module.exports = {
  mockInvoices,
};
