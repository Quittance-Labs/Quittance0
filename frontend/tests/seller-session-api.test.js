const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { AxiosError } = require('axios');

const ROOT = path.resolve(__dirname, '..');
const ALICE = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const BOB = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const TESTNET = 'Test SDF Network ; September 2015';
let app;
const persisted = new Map();

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test.before(async () => {
  globalThis.localStorage = {
    getItem: (key) => persisted.get(key) ?? null,
    setItem: (key, value) => persisted.set(key, value),
    removeItem: (key) => persisted.delete(key),
  };
  const result = await esbuild.build({
    stdin: {
      contents: `export { default as api, invoiceApi, sellerSessionManager } from './lib/api';
        export { useWalletStore } from './lib/store';
        export { setSigner } from '@/lib/stellar';`,
      resolveDir: ROOT, sourcefile: 'seller-session-test.ts', loader: 'ts',
    },
    absWorkingDir: ROOT, bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['axios', 'zustand', 'zustand/middleware'], tsconfig: 'tsconfig.json',
    define: {
      'process.env.NEXT_PUBLIC_STELLAR_NETWORK': '"TESTNET"',
      'process.env.NEXT_PUBLIC_API_URL': '"http://127.0.0.1:3001/api"',
    },
    plugins: [{
      name: 'freighter-dialog-only',
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/stellar$/ }, () => ({ path: 'stellar', namespace: 'wallet-test' }));
        build.onLoad({ filter: /.*/, namespace: 'wallet-test' }, () => ({
          contents: `let signer;
            export const setSigner = (next) => { signer = next; };
            export const signSellerChallenge = (...args) => signer(...args);`, loader: 'js',
        }));
      },
    }],
  });
  const compiled = new Module('seller-session-api-test');
  compiled.filename = path.join(ROOT, 'seller-session-api-test.cjs');
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(result.outputFiles[0].text, compiled.filename);
  app = compiled.exports;
});

function prepare(seller = ALICE) {
  persisted.clear();
  app.sellerSessionManager.clear();
  app.useWalletStore.setState({
    publicKey: seller, connected: true, network: 'TESTNET', networkPassphrase: TESTNET,
    freighterAvailable: true, balance: '0',
  });
  app.setSigner(async (challenge) => `signed:${challenge.transaction}`);
  const calls = [];
  let issued = 0;
  const respond = (config, data) => ({ status: 200, statusText: 'OK', headers: {}, config, data });
  const unauthorized = (config) => {
    throw new AxiosError('Expired', 'ERR_BAD_REQUEST', config, undefined, {
      status: 401, statusText: 'Unauthorized', headers: {}, config,
      data: { success: false, code: 'AUTH_SESSION_EXPIRED', error: 'Seller session expired.' },
    });
  };
  function auth(config) {
    calls.push({ url: config.url, method: config.method, token: config.headers.Authorization, signal: config.signal });
    if (config.url === '/auth/challenge') {
      return respond(config, { success: true, data: { transaction: config.params.account } });
    }
    if (config.url === '/auth/session') {
      const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
      const sellerPublicKey = body.transaction.replace('signed:', '');
      return respond(config, { success: true, data: {
        token: `token-${sellerPublicKey}-${++issued}`, sellerPublicKey,
        network: 'TESTNET', expiresAt: Math.floor(Date.now() / 1000) + 3600,
      } });
    }
    return null;
  }
  return { calls, respond, unauthorized, auth };
}

test('dashboard list and stats earn one bearer session; public pay reads stay anonymous', async () => {
  const fixture = prepare();
  app.api.defaults.adapter = async (config) => fixture.auth(config) || fixture.respond(config, { data: [] });
  await Promise.all([app.invoiceApi.getAll({ sellerPublicKey: ALICE }), app.invoiceApi.getStats(ALICE)]);
  await app.invoiceApi.getById('public-pay-link');
  assert.equal(fixture.calls.filter((call) => call.url === '/auth/challenge').length, 1);
  assert.equal(fixture.calls.filter((call) => call.url === '/auth/session').length, 1);
  assert.equal(fixture.calls.find((call) => call.url === '/invoices').token, `Bearer token-${ALICE}-1`);
  assert.equal(fixture.calls.find((call) => call.url === '/invoices/stats').token, `Bearer token-${ALICE}-1`);
  assert.equal(fixture.calls.find((call) => call.url === '/invoices/public-pay-link').token, undefined);
  assert.doesNotMatch([...persisted.values()].join(''), /token-/);
});

test('a seller request challenges once after 401 and never loops on a second 401', async () => {
  const fixture = prepare();
  let attempts = 0;
  app.api.defaults.adapter = async (config) => {
    const result = fixture.auth(config);
    if (result) return result;
    if (++attempts === 1) return fixture.unauthorized(config);
    return fixture.respond(config, { data: ['accepted'] });
  };
  assert.deepEqual(await app.invoiceApi.getStats(ALICE), { data: ['accepted'] });
  assert.equal(fixture.calls.filter((call) => call.url === '/auth/challenge').length, 2);
  assert.equal(attempts, 2);

  const second = prepare();
  app.api.defaults.adapter = async (config) => second.auth(config) || second.unauthorized(config);
  await assert.rejects(app.invoiceApi.getStats(ALICE), { code: 'AUTH_SESSION_EXPIRED' });
  assert.equal(second.calls.filter((call) => call.url === '/auth/challenge').length, 2);
  assert.equal(second.calls.filter((call) => call.url === '/invoices/stats').length, 2);
});

test('wallet switch while Freighter is signing cannot redeem or fetch for the old seller', async () => {
  const fixture = prepare();
  const dialog = deferred();
  const opened = deferred();
  app.setSigner(async () => { opened.resolve(); return dialog.promise; });
  app.api.defaults.adapter = async (config) => fixture.auth(config) || fixture.respond(config, { data: [] });
  const request = app.invoiceApi.getAll({ sellerPublicKey: ALICE });
  await opened.promise;
  app.useWalletStore.setState({ publicKey: BOB });
  dialog.resolve(`signed:${ALICE}`);
  await assert.rejects(request, { code: 'WALLET_SESSION_CHANGED' });
  assert.deepEqual(fixture.calls.map((call) => call.url), ['/auth/challenge']);
  assert.equal(app.sellerSessionManager.cachedToken(app.sellerSessionManager.contextFor(BOB)), null);
});

test('wallet switch mid-dashboard aborts the old fetch and its 401 cannot sign in the new account', async () => {
  const fixture = prepare();
  const pending = deferred();
  const requested = deferred();
  let oldConfig;
  app.api.defaults.adapter = async (config) => {
    const result = fixture.auth(config);
    if (result) return result;
    oldConfig = config;
    requested.resolve();
    await pending.promise;
    return fixture.unauthorized(config);
  };
  const request = app.invoiceApi.getAll({ sellerPublicKey: ALICE });
  await requested.promise;
  app.useWalletStore.setState({ publicKey: BOB });
  assert.equal(oldConfig.signal.aborted, true, 'the store update aborts old seller traffic synchronously');
  assert.equal(app.sellerSessionManager.cachedToken(app.sellerSessionManager.contextFor(BOB)), null);
  pending.resolve();
  await assert.rejects(request, { code: 'WALLET_SESSION_CHANGED' });
  assert.equal(fixture.calls.filter((call) => call.url === '/auth/challenge').length, 1);
});

test('create, workspace detail, audit events and cancel all carry the earned session', async () => {
  const fixture = prepare();
  const bodies = [];
  app.api.defaults.adapter = async (config) => {
    const result = fixture.auth(config);
    if (result) return result;
    bodies.push(config.data && JSON.parse(config.data));
    return fixture.respond(config, { data: {} });
  };
  await app.invoiceApi.create({ amount: 1, expiresInDays: 7, sellerPublicKey: ALICE });
  await app.invoiceApi.getById('invoice', ALICE);
  await app.invoiceApi.getPaymentEvents('invoice', ALICE);
  await app.invoiceApi.cancel('invoice', ALICE);
  const sellerCalls = fixture.calls.filter((call) => !call.url.startsWith('/auth/'));
  assert.equal(sellerCalls.length, 4);
  assert.ok(sellerCalls.every((call) => call.token === `Bearer token-${ALICE}-1`));
  assert.deepEqual(bodies.at(-1), { sellerPublicKey: ALICE }, 'cancel has no reusable blob signature');
});
