const test = require('node:test');
const assert = require('node:assert/strict');

const {
  accountHasTrustline,
  classifyAccountLookupError,
  classifyTrustlinePreflight,
  trustlinePreflightMessage,
  looksLikeVerifyRejection,
  VERIFY_REJECTION_MARKERS,
} = require('../lib/trustline-preflight.ts');

const {
  USDC_ISSUER,
  noTrustlineAccount,
  trustlineExistsAccount,
  wrongIssuerAccount,
  xlmInvoice,
  usdcInvoice,
  notFoundError,
  horizonOutageError,
} = require('./fixtures/trustline-preflight.fixture.js');

const fundedWithUsdc = trustlineExistsAccount;
const fundedWithoutUsdc = noTrustlineAccount;

test('native XLM never needs a trustline check', () => {
  assert.deepEqual(
    classifyTrustlinePreflight({ assetCode: 'XLM' }),
    { ok: true, code: 'NATIVE_ASSET' }
  );
  assert.equal(accountHasTrustline(fundedWithoutUsdc, 'XLM', ''), false);
});

test('an account holding the asset passes the preflight', () => {
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    account: fundedWithUsdc,
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
});

test('a funded account without the trustline is blocked as MISSING_TRUSTLINE', () => {
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    account: fundedWithoutUsdc,
    networkLabel: 'testnet',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_TRUSTLINE');
  assert.equal(result.retryable, undefined);
  assert.match(result.message, /USDC trustline/);
  assert.match(result.message, /testnet/);
});

test('a same-code trustline under a different issuer does not count', () => {
  const otherIssuer = { balances: [{ asset_type: 'credit_alphanum4', asset_code: 'USDC', asset_issuer: 'G' + 'E'.repeat(55) }] };
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    account: otherIssuer,
  });
  assert.equal(result.code, 'MISSING_TRUSTLINE');
});

test('a missing asset issuer can never prove the trustline', () => {
  const result = classifyTrustlinePreflight({ assetCode: 'USDC', account: fundedWithUsdc });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_TRUSTLINE');
});

test('a 404 account lookup means unfunded, not trustline-verified', () => {
  const notFound = Object.assign(new Error('Not Found'), { response: { status: 404 } });
  assert.equal(classifyAccountLookupError(notFound), 'ACCOUNT_NOT_FOUND');
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    error: notFound,
    networkLabel: 'testnet',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACCOUNT_NOT_FOUND');
  assert.equal(result.retryable, false);
  assert.match(result.message, /not funded/);
});

test('a Horizon outage is retryable and never a fake pass', () => {
  const outage = Object.assign(new Error('timeout of 8000ms exceeded'), { code: 'ECONNABORTED' });
  assert.equal(classifyAccountLookupError(outage), 'HORIZON_UNAVAILABLE');
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    error: outage,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HORIZON_UNAVAILABLE');
  assert.equal(result.retryable, true);
  assert.match(result.message, /try again/i);
});

test('a 5xx Horizon response classifies as outage', () => {
  const err = Object.assign(new Error('Service Unavailable'), { response: { status: 503 } });
  assert.equal(classifyAccountLookupError(err), 'HORIZON_UNAVAILABLE');
});

test('no account object and no error means unfunded', () => {
  const result = classifyTrustlinePreflight({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUER,
    account: null,
  });
  assert.equal(result.code, 'ACCOUNT_NOT_FOUND');
});

test('asset codes normalize before comparing', () => {
  const result = classifyTrustlinePreflight({
    assetCode: 'usdc',
    assetIssuer: USDC_ISSUER,
    account: fundedWithUsdc,
  });
  assert.equal(result.ok, true);
});

test('trustline copy names the asset and the network', () => {
  const message = trustlinePreflightMessage('MISSING_TRUSTLINE', 'USDC', 'testnet');
  assert.match(message, /USDC/);
  assert.match(message, /testnet/);
  assert.match(message, /XLM invoice/);
});


test('fixture: XLM invoice skips trustline regardless of account', () => {
  const result = classifyTrustlinePreflight({
    assetCode: xlmInvoice.assetCode,
    assetIssuer: xlmInvoice.assetIssuer,
    account: noTrustlineAccount,
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'NATIVE_ASSET');
});

test('fixture: no account (unfunded) blocks USDC before Freighter', () => {
  const result = classifyTrustlinePreflight({
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    error: notFoundError,
    networkLabel: 'testnet',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ACCOUNT_NOT_FOUND');
  assert.equal(looksLikeVerifyRejection(result.message), false);
});

test('fixture: no trustline blocks USDC before Freighter', () => {
  const result = classifyTrustlinePreflight({
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    account: noTrustlineAccount,
    networkLabel: 'testnet',
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MISSING_TRUSTLINE');
  assert.match(result.message, /Add the USDC trustline/i);
  assert.equal(looksLikeVerifyRejection(result.message), false);
});

test('fixture: trustline exists allows USDC preflight', () => {
  const result = classifyTrustlinePreflight({
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    account: trustlineExistsAccount,
  });
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OK');
});

test('fixture: Horizon outage is retryable, never a fake trustline pass', () => {
  const result = classifyTrustlinePreflight({
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    error: horizonOutageError,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'HORIZON_UNAVAILABLE');
  assert.equal(result.retryable, true);
  assert.equal(looksLikeVerifyRejection(result.message), false);
});

test('trustline copy is never a verify memo/amount/destination rejection', () => {
  for (const code of ['MISSING_TRUSTLINE', 'ACCOUNT_NOT_FOUND', 'HORIZON_UNAVAILABLE']) {
    const message = trustlinePreflightMessage(code, 'USDC', 'testnet');
    assert.equal(looksLikeVerifyRejection(message), false);
    for (const marker of VERIFY_REJECTION_MARKERS) {
      assert.equal(
        message.toLowerCase().includes(marker.toLowerCase()),
        false,
        `${code} message must not contain ${marker}`
      );
    }
  }
});

test('wrong-issuer USDC fixture still counts as missing trustline', () => {
  const result = classifyTrustlinePreflight({
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    account: wrongIssuerAccount,
  });
  assert.equal(result.code, 'MISSING_TRUSTLINE');
});

test('mounted PaymentButton recovers from an unfunded account through explicit balance rechecks', async (t) => {
  const path = require('node:path');
  const Module = require('node:module');
  const esbuild = require('esbuild');
  const { ALIASES, installDom, render } = require('./support/a11y-harness');

  installDom();
  const React = require('react');
  const root = path.resolve(__dirname, '..');
  const payer = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
  const destination = 'GCKFBEIYTKP7RCZNVPH6PYJHLKGRDJKA76G3XV5F9RBQZBRPKUL7NXCG';
  const networkPassphrase = 'Test SDF Network ; September 2015';
  const session = { publicKey: payer, connected: true, freighterAvailable: true,
    network: 'TESTNET', networkPassphrase };
  let accountResponse = { error: notFoundError };

  // Replace account/wallet I/O, while retaining the real classifier, payment
  // button, store and transaction builder. The same mounted button must read
  // each new account response; no test code advances its React state.
  const preflight = t.mock.fn(async (publicKey, assetCode, assetIssuer) =>
    classifyTrustlinePreflight({ ...accountResponse, assetCode, assetIssuer, networkLabel: 'testnet' })
  );
  const loadAccount = t.mock.fn(async () => {
    if (accountResponse.error) throw accountResponse.error;
    return accountResponse.account;
  });
  const checkWalletConnection = t.mock.fn(async () => true);
  const requestWalletAccess = t.mock.fn(async () => true);
  const addTrustline = t.mock.fn(async () => { throw new Error('Unexpected change_trust request'); });
  const signTransaction = t.mock.fn(async () => { throw new Error('Unexpected signing request'); });
  const submitTransaction = t.mock.fn(async () => { throw new Error('Unexpected transaction submission'); });
  const stellar = {
    EXPECTED_WALLET_NETWORK: 'TESTNET',
    NETWORK_PASSPHRASE: networkPassphrase,
    NETWORK_DISPLAY_NAME: 'Testnet',
    checkWalletConnection,
    requestWalletAccess,
    getFreighterNetwork: async () => session,
    isWrongNetwork: () => false,
    readFreighterSession: async () => session,
    assertFreighterReady: async () => session,
    preflightAssetTrustline: preflight,
    addTrustline,
    loadAccount,
    isValidPublicKey: (value) => value === destination,
    server: { submitTransaction },
  };

  // Reuse the existing audit's DOM renderer and SDK/transport aliases, but
  // bundle only this flow. External test adapters are injected into the
  // compiled module rather than written to shared temporary files.
  const result = esbuild.buildSync({
    stdin: {
      contents: `
        export { default as PaymentButton } from '@/components/PaymentButton';
        export { useWalletStore } from '@/lib/store';
        export { getCalls } from 'axios';
      `,
      resolveDir: root,
      sourcefile: 'trustline-recovery-entry.jsx',
      loader: 'jsx',
    },
    absWorkingDir: root,
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    alias: {
      ...ALIASES,
      '@/lib/stellar': 'trustline-test-stellar',
      '@stellar/freighter-api': 'trustline-test-freighter',
    },
    external: ['react', 'react-dom', 'trustline-test-stellar', 'trustline-test-freighter'],
    tsconfig: 'tsconfig.json',
    define: {
      'process.env.NEXT_PUBLIC_STELLAR_NETWORK': '"TESTNET"',
      'process.env.NEXT_PUBLIC_API_URL': '"http://127.0.0.1:3001/api"',
    },
    logLevel: 'silent',
  });
  const compiled = new Module('trustline-recovery-bundle');
  compiled.filename = path.join(root, 'trustline-recovery-bundle.js');
  compiled.paths = Module._nodeModulePaths(root);
  const requireModule = compiled.require.bind(compiled);
  compiled.require = (name) => {
    if (name === 'trustline-test-stellar') return stellar;
    if (name === 'trustline-test-freighter') return { signTransaction };
    return requireModule(name);
  };
  compiled._compile(result.outputFiles[0].text, compiled.filename);
  const bundle = compiled.exports;
  bundle.useWalletStore.setState({ ...session, balance: '0' });

  const { container, unmount } = await render(React.createElement(bundle.PaymentButton, {
    destination,
    amount: usdcInvoice.amount,
    assetCode: usdcInvoice.assetCode,
    assetIssuer: usdcInvoice.assetIssuer,
    memo: 'QT-RECOVERY-565',
    invoiceId: 'inv_trustline_recovery',
    payerName: 'Ada Lovelace',
    payerEmail: 'ada@example.com',
  }));
  t.after(unmount);

  const pay = container.querySelector('button[data-payment-state]');
  const recheck = () => container.querySelector('[data-action="recheck-trustline"]');
  const assertUnsigned = () => {
    assert.equal(addTrustline.mock.callCount(), 0, 'rechecking must not request change_trust');
    assert.equal(signTransaction.mock.callCount(), 0, 'rechecking must not open signing');
    assert.equal(submitTransaction.mock.callCount(), 0, 'rechecking must not submit a payment');
    assert.deepEqual(bundle.getCalls(), [], 'rechecking must not verify a payment');
  };
  const click = async (button) => {
    assert.ok(button, 'the recovery action must be rendered');
    assert.equal(button.disabled, false, 'the recovery action must be enabled');
    await React.act(async () => button.click());
  };

  await click(pay);
  assert.ok(container.querySelector('[data-preflight="ACCOUNT_NOT_FOUND"]'));
  assert.equal(pay.disabled, true, 'an unfunded account cannot pay');
  assert.equal(pay.getAttribute('aria-disabled'), 'true');
  assert.equal((await preflight.mock.calls[0].result).retryable, false);
  assert.equal(checkWalletConnection.mock.callCount(), 0);
  assert.equal(requestWalletAccess.mock.callCount(), 0);
  assert.equal(loadAccount.mock.callCount(), 0, 'the builder must not run while unfunded');
  assert.equal(container.querySelector('[data-action="add-trustline"]'), null);
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assertUnsigned();
  assert.ok(recheck(), 'ACCOUNT_NOT_FOUND must offer Recheck balances without remounting');
  assert.match(recheck().textContent, /Recheck balances/);

  // Funding alone must not enable payment. Rechecking discovers that the
  // funded account still needs the invoice issuer's trustline.
  accountResponse = { account: noTrustlineAccount };
  assert.equal(preflight.mock.callCount(), 1, 'account changes are only read on explicit recheck');
  await click(recheck());
  assert.ok(container.querySelector('[data-preflight="MISSING_TRUSTLINE"]'));
  assert.equal(pay.disabled, true, 'funding alone does not prove the trustline');
  assert.equal(pay.getAttribute('aria-disabled'), 'true');
  assert.ok(container.querySelector('[data-action="add-trustline"]'));
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(requestWalletAccess.mock.callCount(), 0);
  assert.equal(loadAccount.mock.callCount(), 0);
  assertUnsigned();

  // The trustline may be added elsewhere. Its next explicit recheck must
  // clear the stale block and open review, while signing still needs consent.
  accountResponse = { account: trustlineExistsAccount };
  assert.equal(preflight.mock.callCount(), 2);
  assert.ok(container.querySelector('[data-preflight="MISSING_TRUSTLINE"]'));
  await click(recheck());
  assert.deepEqual(preflight.mock.calls.map((call) => call.arguments), [
    [payer, usdcInvoice.assetCode, USDC_ISSUER],
    [payer, usdcInvoice.assetCode, USDC_ISSUER],
    [payer, usdcInvoice.assetCode, USDC_ISSUER],
  ]);
  assert.equal(loadAccount.mock.callCount(), 1, 'only the successful recheck may build a payment');
  assert.equal(requestWalletAccess.mock.callCount(), 1);
  assert.equal(container.querySelector('[data-preflight]'), null);
  assert.equal(recheck(), null);
  assert.equal(pay.disabled, false);
  assert.equal(pay.getAttribute('aria-disabled'), 'false');
  const review = container.querySelector('[role="dialog"]');
  assert.ok(review, 'the same mounted button must reach payment review');
  assert.match(review.textContent, /Review payment/);
  assert.match(review.textContent, /25 USDC/);
  assert.match(review.textContent, /QT-RECOVERY-565/);
  assert.ok(review.querySelector(`[aria-label="Destination: ${destination}"]`));
  assert.match(review.textContent, /Confirm & sign/);
  assertUnsigned();

  await click(review.querySelector('[aria-label="Cancel payment"]'));
  assert.equal(container.querySelector('[role="dialog"]'), null);
  assertUnsigned();
});
