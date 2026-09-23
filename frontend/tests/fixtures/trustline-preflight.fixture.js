const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const PAYER_PUBLIC_KEY = 'GBRAI2A2B3K6VRJ75D76T4W2W7W3Q42Z3QG34A6S7D8F9G0H1J2K3L4M';
const SELLER_PUBLIC_KEY = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7';

const noAccountError = Object.assign(new Error('Account not found'), {
  status: 404,
  name: 'NotFoundError',
  response: { status: 404, data: { status: 404, title: 'Resource Missing' } },
});

const horizonOutageError = Object.assign(new Error('Stellar Horizon is temporarily unreachable'), {
  status: 503,
  code: 'ERR_NETWORK',
  response: { status: 503, data: { status: 503, title: 'Service Unavailable' } },
});

const noTrustlineAccount = {
  id: PAYER_PUBLIC_KEY,
  sequence: '100',
  balances: [
    {
      asset_type: 'native',
      balance: '50.0000000',
    },
  ],
};

const trustlineAccount = {
  id: PAYER_PUBLIC_KEY,
  sequence: '100',
  balances: [
    {
      asset_type: 'native',
      balance: '50.0000000',
    },
    {
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: USDC_ISSUER,
      balance: '120.500000',
      limit: '1000000.0000000',
    },
  ],
};

const xlmInvoice = {
  id: 'inv_xlm_test',
  amount: 25,
  assetCode: 'XLM',
  sellerPublicKey: SELLER_PUBLIC_KEY,
  memo: 'Q0-INV-XLM',
  status: 'PENDING',
};

const usdcInvoice = {
  id: 'inv_usdc_test',
  amount: 15.5,
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
  sellerPublicKey: SELLER_PUBLIC_KEY,
  memo: 'Q0-INV-USDC',
  status: 'PENDING',
};

module.exports = {
  USDC_ISSUER,
  PAYER_PUBLIC_KEY,
  SELLER_PUBLIC_KEY,
  noAccountError,
  horizonOutageError,
  noTrustlineAccount,
  trustlineAccount,
  xlmInvoice,
  usdcInvoice,
};
