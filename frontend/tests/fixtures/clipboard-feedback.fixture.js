module.exports = {
  copyableText: [
    'https://quittance.example/pay/invoice-123',
    'web+stellar:pay?destination=GEXAMPLE&amount=10',
    '',
    '  payment link  ',
    'Payment receipt: ✓\nInvoice 123',
  ],
  invalidText: [undefined, null, 123, true, {}, []],
};
