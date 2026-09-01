const invoiceSharePathFixture = [
  { input: 'invoice-123', output: '/pay/invoice-123' },
  { input: 'invoice with spaces', output: '/pay/invoice%20with%20spaces' },
  { input: '', output: '/pay/' },
];

module.exports = { invoiceSharePathFixture };

