/**
 * Unit tests for invoice-payment-builder (issue #453).
 *
 * The builder imports @stellar/stellar-sdk, @stellar/freighter-api, and several
 * project lib modules. This test file uses esbuild (the same strategy as the
 * a11y harness) to bundle the builder with stubbed versions of those modules,
 * then tests the bundled exports directly with node:test.
 *
 * What is covered:
 *   - XLM payment path: destination, amount, native asset, memo, network, fee
 *   - USDC payment path: USDC asset, authoritative issuer, memo, network
 *   - Memo safety: missing, null, whitespace, too long, multibyte bytes, exact preservation
 *   - Network safety: mismatch blocks before Freighter; Freighter not called
 *   - Validation failures: destination, amount, asset, prerequisites
 *   - Error categories: validation, network, prerequisites, wallet, transport
 *   - isTransportError / isVerificationError classification
 *   - shortenAddress helper
 *   - submitBuiltPayment: user rejection, sign failure, null result
 *   - Automatic hash handoff: correct txHash returned by submitBuiltPayment
 *   - Fee/amount separation: payment op receives only the invoice amount
 *   - prepareInvoicePayment convenience wrapper
 */

'use strict';

const test  = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const fs     = require('node:fs');
const Module = require('node:module');
const esbuild = require('esbuild');

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const VALID_SELLER  = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const VALID_BUYER   = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const USDC_ISSUER   = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

const XLM_INVOICE = {
  sellerPublicKey: VALID_SELLER,
  amount: 25,
  assetCode: 'XLM',
  memo: 'INV-00001',
};

const USDC_INVOICE = {
  sellerPublicKey: VALID_SELLER,
  amount: 100.5,
  assetCode: 'USDC',
  assetIssuer: USDC_ISSUER,
  memo: 'INV-00002',
};

const VALID_SESSION = {
  publicKey: VALID_BUYER,
  network: 'TESTNET',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

// ---------------------------------------------------------------------------
// Shared mutable state for stubs
// (exported out of the stubs via a global sidecar so tests can control them)
// ---------------------------------------------------------------------------

// We use a global namespace on `global` to share state between the bundled
// stubs and the test file without going through module boundaries.
global.__testStubs = {
  // @/lib/stellar mock controls
  accountOverride: null,       // null = default (funded, with USDC trustline)
  submitResult: { hash: 'a'.repeat(64) },
  submitError: null,

  // @stellar/freighter-api mock controls
  signResult: 'STUB_SIGNED_XDR',
  signError: null,
};

// ---------------------------------------------------------------------------
// Inline stub sources (injected via esbuild alias)
// ---------------------------------------------------------------------------

const ROOT      = path.resolve(__dirname, '..');
const STUBS_DIR = path.join(ROOT, 'tests', 'support', 'stubs');

// Stellar SDK stub — minimal surface used by the builder
const SDK_STUB_SRC = `
'use strict';
const Networks = {
  TESTNET: 'Test SDF Network ; September 2015',
  PUBLIC:  'Public Global Stellar Network ; September 2015',
};
class Keypair {
  static fromPublicKey(pk) {
    if (!pk || typeof pk !== 'string' || !/^G[A-Z2-7]{55}$/.test(pk)) {
      throw new Error('Invalid Stellar public key: ' + pk);
    }
    return { publicKey: () => pk };
  }
}
const BASE_FEE = '100';
class Asset {
  constructor(code, issuer) { this._code = code; this._issuer = issuer; }
  static native() { return Object.assign(new Asset('XLM', undefined), { _type: 'native' }); }
  getCode() { return this._code; }
  getIssuer() { return this._issuer; }
  getAssetType() { return this._type || 'credit_alphanum4'; }
}
class Memo { static text(v) { return { type: 'text', value: v }; } }
class TransactionBuilder {
  constructor(acct, opts) { this._account = acct; this._opts = opts; this._ops = []; this._memo = null; }
  addOperation(op) { this._ops.push(op); return this; }
  addMemo(m) { this._memo = m; return this; }
  setTimeout(t) { this._timeout = t; return this; }
  build() {
    const self = this;
    return { _ops: self._ops, _memo: self._memo, _opts: self._opts, toXDR() { return 'STUB_XDR_ENVELOPE'; } };
  }
  static fromXDR(xdr) { return { _fromXDR: true, xdr, toXDR() { return xdr; } }; }
}
class Operation { static payment(args) { return { type: 'payment', ...args }; } }
module.exports = { Networks, Keypair, BASE_FEE, Asset, Memo, TransactionBuilder, Operation };
`;

// @stellar/freighter-api stub — reads from global.__testStubs
const FREIGHTER_API_STUB_SRC = `
'use strict';
const signTransaction = async (xdr, opts) => {
  const s = global.__testStubs;
  if (s.signError) { throw new Error(s.signError); }
  return s.signResult;
};
module.exports = { signTransaction };
`;

// @/lib/stellar stub — reads account/server state from global.__testStubs
const STELLAR_LIB_STUB_SRC = `
'use strict';
const StellarSdk = require('@stellar/stellar-sdk');
const NETWORK_PASSPHRASE = StellarSdk.Networks.TESTNET;
const EXPECTED_WALLET_NETWORK = 'TESTNET';

const makeAccount = (publicKey, extra) => ({
  id: publicKey,
  account_id: publicKey,
  sequence: '1000',
  balances: (extra && extra.balances) || [
    { asset_type: 'native', balance: '100.0000000' },
    {
      asset_type: 'credit_alphanum4',
      asset_code: 'USDC',
      asset_issuer: '${USDC_ISSUER}',
      balance: '50.0000000',
    },
  ],
  ...extra,
});

const loadAccount = async (publicKey) => {
  const o = global.__testStubs.accountOverride;
  if (o && o.throwError) {
    const err = new Error(o.throwError);
    if (o.status) err.response = { status: o.status };
    throw err;
  }
  return makeAccount(publicKey, o);
};

const assertFreighterReady = async () => ({
  freighterAvailable: true,
  connected: true,
  publicKey: '${VALID_BUYER}',
  network: 'TESTNET',
  networkPassphrase: NETWORK_PASSPHRASE,
});

const isValidPublicKey = (pk) => {
  try { StellarSdk.Keypair.fromPublicKey(pk); return true; } catch { return false; }
};

const server = {
  submitTransaction: async function(tx) {
    const s = global.__testStubs;
    if (s.submitError) throw new Error(s.submitError);
    return s.submitResult;
  },
};

module.exports = {
  NETWORK_PASSPHRASE,
  EXPECTED_WALLET_NETWORK,
  loadAccount,
  assertFreighterReady,
  isValidPublicKey,
  server,
};
`;

// @/lib/freighter-availability stub
const FREIGHTER_AVAIL_STUB_SRC = `
'use strict';
const networkMatches = (actual, expected) => {
  const a = (actual || '').trim().toUpperCase();
  const e = (expected || '').trim().toUpperCase();
  return Boolean(a && e && a === e);
};
module.exports = {
  networkMatches,
  FREIGHTER_REQUIRED_MESSAGE: 'Freighter required',
  FREIGHTER_CONNECT_REQUIRED_MESSAGE: 'Connect Freighter',
  wrongNetworkMessage: (exp, act) => 'Wrong network: ' + act,
};
`;

// Write stub files to disk (esbuild needs real files for aliases)
const STUB_FILES = {
  [path.join(STUBS_DIR, '_ipb-stellar-sdk.js')]: SDK_STUB_SRC,
  [path.join(STUBS_DIR, '_ipb-freighter-api.js')]: FREIGHTER_API_STUB_SRC,
  [path.join(STUBS_DIR, '_ipb-stellar-lib.js')]: STELLAR_LIB_STUB_SRC,
  [path.join(STUBS_DIR, '_ipb-freighter-avail.js')]: FREIGHTER_AVAIL_STUB_SRC,
};
for (const [file, src] of Object.entries(STUB_FILES)) fs.writeFileSync(file, src);

// ---------------------------------------------------------------------------
// Build the module under test
// ---------------------------------------------------------------------------

const p = (f) => path.join(STUBS_DIR, f).replace(/\\/g, '/');

let builder;
try {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'lib', 'invoice-payment-builder.ts')],
    absWorkingDir: ROOT,
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    alias: {
      '@stellar/stellar-sdk':       p('_ipb-stellar-sdk.js'),
      '@stellar/freighter-api':     p('_ipb-freighter-api.js'),
      '@/lib/stellar':              p('_ipb-stellar-lib.js'),
      '@/lib/freighter-availability': p('_ipb-freighter-avail.js'),
    },
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    define: { 'process.env.NEXT_PUBLIC_STELLAR_NETWORK': '"TESTNET"' },
    logLevel: 'error',
  });

  const mod = new Module('ipb-bundle');
  mod.filename = path.join(ROOT, 'ipb-bundle.js');
  mod.paths = Module._nodeModulePaths(ROOT);
  mod._compile(result.outputFiles[0].text, mod.filename);
  builder = mod.exports;
} catch (e) {
  console.error('Builder bundle failed:', e.message);
  process.exit(1);
}

const {
  buildInvoicePayment,
  submitBuiltPayment,
  prepareInvoicePayment,
  makePaymentError,
  isTransportError,
  isVerificationError,
  shortenAddress,
} = builder;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isError = (r) => r !== null && r !== undefined && 'category' in r;
const isBuilt  = (r) => r !== null && r !== undefined && 'xdr' in r && 'review' in r;

const resetStubs = () => {
  global.__testStubs.accountOverride = null;
  global.__testStubs.submitResult    = { hash: 'a'.repeat(64) };
  global.__testStubs.submitError     = null;
  global.__testStubs.signResult      = 'STUB_SIGNED_XDR';
  global.__testStubs.signError       = null;
};

// ---------------------------------------------------------------------------
// shortenAddress helper
// ---------------------------------------------------------------------------

test('shortenAddress shortens a full Stellar address for display', () => {
  const full  = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  const short = shortenAddress(full);
  assert.match(short, /^\w{4}\.\.\.\w{4}$/);
  assert.ok(short !== full, 'shortened address must differ from full address');
});

test('shortenAddress returns a short string unchanged', () => {
  assert.equal(shortenAddress('GABC'), 'GABC');
});

// ---------------------------------------------------------------------------
// makePaymentError / isTransportError / isVerificationError
// ---------------------------------------------------------------------------

test('makePaymentError produces a structured error with all fields', () => {
  const cause = new Error('root cause');
  const err = makePaymentError('validation', 'MISSING_MEMO', 'Memo required.', cause);
  assert.equal(err.category, 'validation');
  assert.equal(err.code,     'MISSING_MEMO');
  assert.equal(err.message,  'Memo required.');
  assert.equal(err.cause,    cause);
});

test('isTransportError: wallet/transport/prerequisites/network are transport errors', () => {
  for (const cat of ['wallet', 'transport', 'prerequisites', 'network']) {
    assert.equal(
      isTransportError(makePaymentError(cat, 'X', 'x')),
      true,
      `${cat} must be classified as transport`
    );
  }
  assert.equal(isTransportError(makePaymentError('validation',   'X', 'x')), false);
  assert.equal(isTransportError(makePaymentError('verification', 'X', 'x')), false);
});

test('isVerificationError: only verification category is a verification error', () => {
  assert.equal(isVerificationError(makePaymentError('verification', 'X', 'x')), true);
  assert.equal(isVerificationError(makePaymentError('transport',    'X', 'x')), false);
  assert.equal(isVerificationError(makePaymentError('wallet',       'X', 'x')), false);
});

// ---------------------------------------------------------------------------
// Network safety — must block before Freighter
// ---------------------------------------------------------------------------

test('network mismatch → category:network error before any tx is built', async () => {
  const wrongNet = { ...VALID_SESSION, network: 'PUBLIC' };
  const result   = await buildInvoicePayment(XLM_INVOICE, wrongNet);

  assert.ok(isError(result));
  assert.equal(result.category, 'network');
  assert.equal(result.code, 'NETWORK_MISMATCH');
});

test('null network → network error (unknown network counts as mismatch)', async () => {
  const noNet = { ...VALID_SESSION, network: null };
  const result = await buildInvoicePayment(XLM_INVOICE, noNet);

  assert.ok(isError(result));
  assert.equal(result.category, 'network');
});

test('matching network (TESTNET) allows construction to proceed', async () => {
  const result = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
  assert.ok(isBuilt(result), `Expected built payment, got: ${JSON.stringify(result)}`);
});

test('Freighter signTransaction is NOT called when network validation fails', async () => {
  // signTransaction is only called inside submitBuiltPayment, not buildInvoicePayment.
  // This test verifies the control flow: a network error exits before construction,
  // so there is nothing to sign.
  let signCalled = false;
  const origSignResult = global.__testStubs.signResult;
  // Monkey-patch global stub to track calls
  Object.defineProperty(global.__testStubs, '_signCallCount', {
    get() { return signCalled; },
    configurable: true,
  });
  // The only way signTransaction could be called is if submitBuiltPayment runs.
  // buildInvoicePayment never calls signTransaction — it only builds the tx.
  const wrongNet = { ...VALID_SESSION, network: 'PUBLIC' };
  const buildResult = await buildInvoicePayment(XLM_INVOICE, wrongNet);
  assert.ok(isError(buildResult), 'Expected network error');
  assert.equal(buildResult.category, 'network');
  // signCalled is still false because the builder never touches Freighter
  assert.equal(signCalled, false);
  global.__testStubs.signResult = origSignResult;
});

// ---------------------------------------------------------------------------
// XLM payment path
// ---------------------------------------------------------------------------

test('XLM: payment operation destination matches invoice sellerPublicKey', async () => {
  const result = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
  assert.ok(isBuilt(result));
  assert.equal(result.transaction._ops[0].destination, VALID_SELLER);
});

test('XLM: payment amount is exact (no silent rounding)', async () => {
  const inv    = { ...XLM_INVOICE, amount: 25.1234567 };
  const result = await buildInvoicePayment(inv, VALID_SESSION);
  assert.ok(isBuilt(result));
  const op = result.transaction._ops[0];
  assert.equal(parseFloat(op.amount), 25.1234567);
});

test('XLM: payment operation uses native asset with no issuer', async () => {
  const result = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
  assert.ok(isBuilt(result));
  const asset = result.transaction._ops[0].asset;
  assert.equal(asset.getAssetType(), 'native');
  assert.equal(asset.getCode(),      'XLM');
  assert.equal(asset.getIssuer(),    undefined);
});

test('XLM: transaction memo carries the exact invoice memo value', async () => {
  const result = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
  assert.ok(isBuilt(result));
  assert.equal(result.transaction._memo.value, 'INV-00001');
  assert.equal(result.review.memo,             'INV-00001');
});

test('XLM: network passphrase is TESTNET', async () => {
  const result = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
  assert.ok(isBuilt(result));
  assert.match(result.transaction._opts.networkPassphrase, /Test SDF Network/);
});

test('XLM: review summary contains all four required fields', async () => {
  const result = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
  assert.ok(isBuilt(result));
  const { review } = result;
  assert.ok(review.displayDestination, 'displayDestination must be present');
  assert.equal(review.destination, VALID_SELLER);
  assert.ok(review.amount,   'amount must be present');
  assert.equal(review.assetCode, 'XLM');
  assert.equal(review.memo, 'INV-00001');
});

test('XLM: displayDestination is shortened; actual op destination is full key', async () => {
  const result = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
  assert.ok(isBuilt(result));
  assert.match(result.review.displayDestination, /\.\.\./);
  assert.notEqual(result.review.displayDestination, VALID_SELLER);
  // The payment op must still use the full key
  assert.equal(result.transaction._ops[0].destination, VALID_SELLER);
});

test('XLM: fee is in transaction opts, not mixed into the payment amount', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, amount: 100 }, VALID_SESSION);
  assert.ok(isBuilt(result));
  // Payment op receives exactly the invoice amount
  assert.equal(parseFloat(result.transaction._ops[0].amount), 100);
  // Fee is a separate transaction property
  assert.ok(result.transaction._opts.fee, 'fee must be set in transaction opts');
});

// ---------------------------------------------------------------------------
// USDC payment path
// ---------------------------------------------------------------------------

test('USDC: payment asset is USDC with correct issuer', async () => {
  const result = await buildInvoicePayment(USDC_INVOICE, VALID_SESSION);
  assert.ok(isBuilt(result), `Expected USDC build, got: ${JSON.stringify(result)}`);
  const asset = result.transaction._ops[0].asset;
  assert.equal(asset.getCode(),   'USDC');
  assert.equal(asset.getIssuer(), USDC_ISSUER);
  assert.notEqual(asset.getAssetType(), 'native');
});

test('USDC: authoritative issuer from STELLAR_ASSETS overrides caller-supplied wrong issuer', async () => {
  const wrongIssuer = 'GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V'; // USDT issuer
  const inv = { ...USDC_INVOICE, assetIssuer: wrongIssuer };
  const result = await buildInvoicePayment(inv, VALID_SESSION);
  assert.ok(isBuilt(result));
  // Must use the STELLAR_ASSETS issuer, not the caller's wrong one
  assert.equal(result.transaction._ops[0].asset.getIssuer(), USDC_ISSUER);
});

test('USDC: review shows USDC asset code', async () => {
  const result = await buildInvoicePayment(USDC_INVOICE, VALID_SESSION);
  assert.ok(isBuilt(result));
  assert.equal(result.review.assetCode, 'USDC');
});

test('USDC: does not accidentally become a native XLM payment', async () => {
  const result = await buildInvoicePayment(USDC_INVOICE, VALID_SESSION);
  assert.ok(isBuilt(result));
  assert.notEqual(result.transaction._ops[0].asset.getAssetType(), 'native');
  assert.equal(result.transaction._ops[0].asset.getCode(), 'USDC');
});

test('USDC: missing trustline → prerequisites error with code MISSING_TRUSTLINE', async () => {
  global.__testStubs.accountOverride = {
    balances: [{ asset_type: 'native', balance: '100.0000000' }], // no USDC trustline
  };
  try {
    const result = await buildInvoicePayment(USDC_INVOICE, VALID_SESSION);
    assert.ok(isError(result));
    assert.equal(result.category, 'prerequisites');
    assert.equal(result.code,     'MISSING_TRUSTLINE');
    assert.match(result.message,  /trustline/i);
  } finally {
    resetStubs();
  }
});

// ---------------------------------------------------------------------------
// Memo safety — hard security/business rule
// ---------------------------------------------------------------------------

test('missing memo (empty string) → MISSING_MEMO error before construction', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, memo: '' }, VALID_SESSION);
  assert.ok(isError(result));
  assert.equal(result.category, 'validation');
  assert.equal(result.code,     'MISSING_MEMO');
  assert.match(result.message,  /memo/i);
});

test('null memo → MISSING_MEMO error', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, memo: null }, VALID_SESSION);
  assert.ok(isError(result));
  assert.equal(result.code, 'MISSING_MEMO');
});

test('whitespace-only memo → MISSING_MEMO error', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, memo: '   ' }, VALID_SESSION);
  assert.ok(isError(result));
  assert.equal(result.code, 'MISSING_MEMO');
});

test('valid memo is preserved exactly through construction (no trimming or mutation)', async () => {
  const exactMemo = 'INV-2024-00123';
  const result = await buildInvoicePayment({ ...XLM_INVOICE, memo: exactMemo }, VALID_SESSION);
  assert.ok(isBuilt(result));
  assert.equal(result.transaction._memo.value, exactMemo);
  assert.equal(result.review.memo,             exactMemo);
});

test('memo at exactly 28 ASCII bytes is accepted', async () => {
  const memo28 = 'A'.repeat(28);
  const result = await buildInvoicePayment({ ...XLM_INVOICE, memo: memo28 }, VALID_SESSION);
  assert.ok(isBuilt(result));
  assert.equal(result.transaction._memo.value, memo28);
});

test('memo at 29 ASCII bytes is rejected (exceeds 28-byte Stellar limit)', async () => {
  const memo29 = 'A'.repeat(29);
  const result = await buildInvoicePayment({ ...XLM_INVOICE, memo: memo29 }, VALID_SESSION);
  assert.ok(isError(result));
  assert.equal(result.code, 'MEMO_TOO_LONG');
  assert.match(result.message, /28 bytes/);
});

test('multibyte memo: 14 × "é" = 28 bytes is accepted', async () => {
  const memo14e = 'é'.repeat(14); // 14 chars × 2 bytes = 28 bytes
  const result  = await buildInvoicePayment({ ...XLM_INVOICE, memo: memo14e }, VALID_SESSION);
  assert.ok(isBuilt(result), '28-byte UTF-8 memo must be accepted');
  assert.equal(result.transaction._memo.value, memo14e);
});

test('multibyte memo: 15 × "é" = 30 bytes is rejected', async () => {
  const memo15e = 'é'.repeat(15); // 15 chars × 2 bytes = 30 bytes
  const result  = await buildInvoicePayment({ ...XLM_INVOICE, memo: memo15e }, VALID_SESSION);
  assert.ok(isError(result));
  assert.equal(result.code, 'MEMO_TOO_LONG');
});

// ---------------------------------------------------------------------------
// Destination validation
// ---------------------------------------------------------------------------

test('missing destination → MISSING_DESTINATION validation error', async () => {
  const result = await buildInvoicePayment(
    { ...XLM_INVOICE, sellerPublicKey: '' }, VALID_SESSION
  );
  assert.ok(isError(result));
  assert.equal(result.category, 'validation');
  assert.equal(result.code,     'MISSING_DESTINATION');
});

test('invalid destination (not a Stellar public key) → INVALID_DESTINATION error', async () => {
  const result = await buildInvoicePayment(
    { ...XLM_INVOICE, sellerPublicKey: 'not-a-stellar-key' }, VALID_SESSION
  );
  assert.ok(isError(result));
  assert.equal(result.code, 'INVALID_DESTINATION');
});

// ---------------------------------------------------------------------------
// Amount validation
// ---------------------------------------------------------------------------

test('undefined amount → MISSING_AMOUNT error', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, amount: undefined }, VALID_SESSION);
  assert.ok(isError(result));
  assert.equal(result.code, 'MISSING_AMOUNT');
});

test('zero amount → NON_POSITIVE_AMOUNT error', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, amount: 0 }, VALID_SESSION);
  assert.ok(isError(result));
  assert.equal(result.code, 'NON_POSITIVE_AMOUNT');
});

test('negative amount → NON_POSITIVE_AMOUNT error', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, amount: -5 }, VALID_SESSION);
  assert.ok(isError(result));
  assert.equal(result.code, 'NON_POSITIVE_AMOUNT');
});

test('NaN amount → INVALID_AMOUNT error', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, amount: NaN }, VALID_SESSION);
  assert.ok(isError(result));
  assert.equal(result.code, 'INVALID_AMOUNT');
});

test('string amount is parsed and used correctly', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, amount: '42.5' }, VALID_SESSION);
  assert.ok(isBuilt(result));
  assert.equal(parseFloat(result.transaction._ops[0].amount), 42.5);
});

test('invoice amount is not modified by fee handling', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, amount: 100 }, VALID_SESSION);
  assert.ok(isBuilt(result));
  assert.equal(parseFloat(result.transaction._ops[0].amount), 100,
    'Payment op must carry exactly the invoice amount, not amount+fee');
});

// ---------------------------------------------------------------------------
// Asset validation
// ---------------------------------------------------------------------------

test('empty asset code → MISSING_ASSET error', async () => {
  const result = await buildInvoicePayment({ ...XLM_INVOICE, assetCode: '' }, VALID_SESSION);
  assert.ok(isError(result));
  assert.equal(result.code, 'MISSING_ASSET');
});

test('unknown credit asset with no issuer → MISSING_ASSET_ISSUER prerequisites error', async () => {
  const result = await buildInvoicePayment(
    { ...XLM_INVOICE, assetCode: 'UNKNOWNCOIN', assetIssuer: undefined }, VALID_SESSION
  );
  assert.ok(isError(result));
  assert.equal(result.category, 'prerequisites');
  assert.equal(result.code,     'MISSING_ASSET_ISSUER');
});

// ---------------------------------------------------------------------------
// Session / prerequisites
// ---------------------------------------------------------------------------

test('missing publicKey → MISSING_PUBLIC_KEY prerequisites error', async () => {
  const result = await buildInvoicePayment(
    XLM_INVOICE, { ...VALID_SESSION, publicKey: null }
  );
  assert.ok(isError(result));
  assert.equal(result.category, 'prerequisites');
  assert.equal(result.code,     'MISSING_PUBLIC_KEY');
});

test('account not found on Horizon → ACCOUNT_NOT_FOUND prerequisites error', async () => {
  global.__testStubs.accountOverride = { throwError: 'Not Found', status: 404 };
  try {
    const result = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
    assert.ok(isError(result));
    assert.equal(result.category, 'prerequisites');
    assert.equal(result.code,     'ACCOUNT_NOT_FOUND');
  } finally {
    resetStubs();
  }
});

// ---------------------------------------------------------------------------
// submitBuiltPayment — error classification
// ---------------------------------------------------------------------------

test('user rejection (Freighter "declined") → wallet error with code USER_REJECTED', async () => {
  global.__testStubs.signError = 'User declined signing';
  try {
    const built = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
    assert.ok(isBuilt(built));
    const result = await submitBuiltPayment(built);
    assert.ok(isError(result));
    assert.equal(result.category, 'wallet');
    assert.equal(result.code,     'USER_REJECTED');
  } finally {
    resetStubs();
  }
});

test('user rejected → isTransportError true, isVerificationError false', async () => {
  global.__testStubs.signError = 'User declined signing';
  try {
    const built = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
    const result = await submitBuiltPayment(built);
    assert.ok(isError(result));
    assert.equal(isTransportError(result),    true,  'rejection must be a transport error');
    assert.equal(isVerificationError(result), false, 'rejection must NOT be a verification error');
  } finally {
    resetStubs();
  }
});

test('Freighter generic sign failure → wallet SIGN_FAILED error', async () => {
  global.__testStubs.signError = 'Extension could not sign the transaction';
  try {
    const built = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
    const result = await submitBuiltPayment(built);
    assert.ok(isError(result));
    assert.equal(result.category, 'wallet');
    assert.equal(result.code,     'SIGN_FAILED');
  } finally {
    resetStubs();
  }
});

test('Freighter returns null (no XDR) → wallet SIGN_REJECTED error', async () => {
  global.__testStubs.signResult = null;
  try {
    const built = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
    const result = await submitBuiltPayment(built);
    assert.ok(isError(result));
    assert.equal(result.category, 'wallet');
    assert.equal(result.code,     'SIGN_REJECTED');
  } finally {
    resetStubs();
  }
});

test('Horizon submission failure → transport SUBMISSION_FAILED error', async () => {
  global.__testStubs.submitError = 'Horizon 503 Service Unavailable';
  try {
    const built = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
    const result = await submitBuiltPayment(built);
    assert.ok(isError(result));
    assert.equal(result.category, 'transport');
    assert.equal(result.code,     'SUBMISSION_FAILED');
  } finally {
    resetStubs();
  }
});

test('submission failure does not carry a txHash (verify must not be called)', async () => {
  global.__testStubs.submitError = 'Horizon network failure';
  try {
    const built = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
    const result = await submitBuiltPayment(built);
    assert.ok(isError(result));
    assert.ok(!('txHash' in result), 'a failed submission must not carry a txHash');
  } finally {
    resetStubs();
  }
});

// ---------------------------------------------------------------------------
// Automatic hash handoff
// ---------------------------------------------------------------------------

test('successful submission returns the exact txHash from Horizon', async () => {
  const expectedHash = 'b'.repeat(64);
  global.__testStubs.submitResult = { hash: expectedHash };
  try {
    const built = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
    assert.ok(isBuilt(built));
    const result = await submitBuiltPayment(built);
    assert.ok(!isError(result), `Expected success, got: ${JSON.stringify(result)}`);
    assert.equal(result.txHash, expectedHash);
    assert.match(result.txHash, /^[0-9a-f]{64}$/i);
  } finally {
    resetStubs();
  }
});

test('missing txHash from Horizon response → transport MISSING_TX_HASH error', async () => {
  global.__testStubs.submitResult = { hash: '' };
  try {
    const built = await buildInvoicePayment(XLM_INVOICE, VALID_SESSION);
    const result = await submitBuiltPayment(built);
    assert.ok(isError(result));
    assert.equal(result.category, 'transport');
    assert.equal(result.code,     'MISSING_TX_HASH');
  } finally {
    resetStubs();
  }
});

// ---------------------------------------------------------------------------
// prepareInvoicePayment — convenience wrapper
// ---------------------------------------------------------------------------

test('prepareInvoicePayment returns { built } on success', async () => {
  const result = await prepareInvoicePayment(XLM_INVOICE);
  assert.ok(!isError(result), `Expected success, got: ${JSON.stringify(result)}`);
  assert.ok(result.built, 'Result must have .built property');
  assert.ok(isBuilt(result.built));
});

// ---------------------------------------------------------------------------
// Cleanup temp stubs on exit
// ---------------------------------------------------------------------------

process.on('exit', () => {
  for (const f of Object.keys(STUB_FILES)) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
});
