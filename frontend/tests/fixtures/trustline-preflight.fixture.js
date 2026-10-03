/**
 * Horizon account fixtures for USDC trustline preflight (issue #506).
 */

const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const OTHER_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IITDMEIUGCYZUH2M7F';

/** Funded account with no credit balances (no USDC trustline). */
const noTrustlineAccount = {
  id: 'GNOUSDCACCOUNT000000000000000000000000000000000000000',
  balances: [{ asset_type: 'native', balance: '100.0000000' }],
};

/** Funded account holding USDC for the invoice issuer. */
const trustlineExistsAccount = {
  id: 'GHASUSDCACCOUNT00000000000000000000000000000000000000',
  balances: [
    { asset_type: 'native', balance: '50.0000000' },
    {
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: USDC_ISSUER,
      balance: '25.0000000',
    },
  ],
};

/** Same asset code, wrong issuer — must not count as a trustline. */
const wrongIssuerAccount = {
  id: 'GWRONGISSUERACCOUNT000000000000000000000000000000000',
  balances: [
    { asset_type: 'native', balance: '50.0000000' },
    {
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: OTHER_ISSUER,
      balance: '10.0000000',
    },
  ],
};

const xlmInvoice = {
  assetCode: 'XLM',
  assetIssuer: null,
  amount: '12.0000000',
};

const usdcInvoice = {
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
  amount: '25.0000000',
};

const notFoundError = Object.assign(new Error('Not Found'), {
  response: { status: 404 },
});

const horizonOutageError = Object.assign(new Error('timeout of 8000ms exceeded'), {
  code: 'ECONNABORTED',
});

module.exports = {
  USDC_ISSUER,
  OTHER_ISSUER,
  noTrustlineAccount,
  trustlineExistsAccount,
  wrongIssuerAccount,
  xlmInvoice,
  usdcInvoice,
  notFoundError,
  horizonOutageError,
};
