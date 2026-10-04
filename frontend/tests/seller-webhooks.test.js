const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const React = require('react');
const esbuild = require('esbuild');
const { installDom, render } = require('./support/a11y-harness');

installDom();
const ROOT = path.resolve(__dirname, '..');
// Use the existing DOM/bundling tools. Only the wallet and HTTP boundary are
// replaced; the component, request signer, store and shared proof are real.
async function loadWebhookBundle() {
const result = await esbuild.build({
  stdin: {
    contents: `
      export { default as SellerWebhooksPanel } from '@/components/SellerWebhooksPanel';
      export { webhookApi, webhookWalletContext } from '@/lib/webhook-api';
      export { useWalletStore } from '@/lib/store';
    `,
    resolveDir: ROOT,
    sourcefile: 'seller-webhooks-entry.tsx',
    loader: 'tsx',
  },
  absWorkingDir: ROOT,
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'node',
  jsx: 'automatic',
  external: ['react', 'react-dom'],
  tsconfig: 'tsconfig.json',
  define: { 'process.env.NEXT_PUBLIC_STELLAR_NETWORK': '"TESTNET"' },
  plugins: [{
    name: 'wallet-and-http-boundaries',
    setup(build) {
      build.onResolve({ filter: /^(?:@\/lib\/stellar|@stellar\/freighter-api)$/ }, () => ({ path: 'wallet', namespace: 'webhook-test' }));
      build.onResolve({ filter: /^\.\/api$/ }, (args) => args.importer.endsWith('/lib/webhook-api.ts')
        ? { path: 'api', namespace: 'webhook-test' } : undefined);
      build.onLoad({ filter: /.*/, namespace: 'webhook-test' }, ({ path: name }) => ({
        contents: name === 'wallet' ? `
          export const EXPECTED_WALLET_NETWORK = 'TESTNET';
          export const assertFreighterReady = async () => ({ ...globalThis.__webhookTest.live });
          export const signBlob = (...args) => globalThis.__webhookTest.sign(...args);
        ` : 'export default { post: (...args) => globalThis.__webhookTest.post(...args) };',
        loader: 'js',
      }));
    },
  }],
  logLevel: 'silent',
});
const compiled = new Module('seller-webhooks-bundle');
compiled.filename = path.join(ROOT, 'seller-webhooks-bundle.js');
compiled.paths = Module._nodeModulePaths(ROOT);
compiled._compile(result.outputFiles[0].text, compiled.filename);
return compiled.exports;
}
let bundle;
test.before(async () => { bundle = await loadWebhookBundle(); });

const ALICE = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const BOB = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const PASSPHRASE = 'Test SDF Network ; September 2015';
const SIGNATURE = Buffer.alloc(64, 7).toString('base64');
const ENDPOINT = {
  id: 'a77b4da9-7787-4265-b2e0-e4ad1b234b27', url: 'https://seller.example/hooks',
  events: ['invoice.created', 'invoice.paid'], enabled: true, failureCount: 0,
  createdAt: '2026-10-04T12:00:00.000Z',
};
const SECRET = 'whsec_shown_once_to_this_seller';
let state;

function wallet(publicKey = ALICE, patch = {}) {
  const live = { publicKey, connected: true, network: 'TESTNET', networkPassphrase: PASSPHRASE, freighterAvailable: true, ...patch };
  state.live = live;
  bundle.useWalletStore.setState(live);
}

function context() {
  const current = bundle.useWalletStore.getState();
  return { sellerPublicKey: current.publicKey, walletContext: bundle.webhookWalletContext(current) };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function click(container, label) {
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === label);
  assert.ok(button, `button ${label} exists`);
  await React.act(async () => { button.click(); });
}

async function submitUrl(container, url) {
  const input = container.querySelector('#webhook-url');
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, url);
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  await React.act(async () => {
    container.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  });
}

test.beforeEach(() => {
  state = {
    signed: [], requests: [], live: {},
    sign: async (blob, options) => {
      state.signed.push({ message: JSON.parse(Buffer.from(blob, 'base64').toString('utf8')), options });
      return SIGNATURE;
    },
    post: async (requestPath, body, options) => {
      state.requests.push({ path: requestPath, body, options });
      const data = requestPath.endsWith('/list') ? { endpoints: [ENDPOINT], deliveries: [] }
        : requestPath.endsWith('/test') ? { eventId: 'test-event' }
          : requestPath.endsWith('/remove') ? { id: ENDPOINT.id, removed: true }
            : { endpoint: ENDPOINT, secret: SECRET };
      return { data: { success: true, data } };
    },
  };
  globalThis.__webhookTest = state;
  wallet();
});

test('all five actions sign the seller, action, destination and fresh nonce before POST', async () => {
  const api = bundle.webhookApi;
  const owner = context();
  await api.list(owner);
  await api.register(owner, ' https://example.com/café?q=é ', ['invoice.paid', 'invoice.created']);
  await api.rotate(owner, ENDPOINT.id);
  await api.test(owner, ENDPOINT.id);
  await api.remove(owner, ENDPOINT.id);
  assert.equal(state.signed.length, 5);
  assert.deepEqual(state.signed.map((item) => item.message.action), ['list', 'register', 'rotate', 'test', 'remove']);
  assert.equal(new Set(state.signed.map((item) => item.message.nonce)).size, 5);
  for (let index = 0; index < state.signed.length; index += 1) {
    const { message, options } = state.signed[index];
    const request = state.requests[index];
    assert.equal(message.domain, 'quittance-webhooks-v1');
    assert.equal(message.sellerPublicKey, ALICE);
    assert.equal(options.accountToSign, ALICE);
    assert.equal(request.body.signature, SIGNATURE);
    assert.equal(request.body.timestamp, message.timestamp);
    assert.equal(request.body.nonce, message.nonce);
    assert.equal(request.body.sellerPublicKey, ALICE);
    assert.equal(request.options.signal.aborted, false);
    assert.equal(message.endpointId, index >= 2 ? ENDPOINT.id : null);
  }
  const register = state.signed[1].message;
  assert.equal(register.url, 'https://example.com/caf%C3%A9?q=%C3%A9');
  assert.equal(register.url, state.requests[1].body.url);
  assert.deepEqual(register.events, ['invoice.created', 'invoice.paid']);
});

test('a wallet A -> B -> A switch during the signing prompt cannot send the old proof', async () => {
  const signing = deferred();
  const started = deferred();
  state.sign = () => { started.resolve(); return signing.promise; };
  const pending = bundle.webhookApi.list(context());
  await started.promise;
  wallet(BOB);
  wallet(ALICE);
  signing.resolve(SIGNATURE);
  await assert.rejects(pending, /wallet or network changed/);
  assert.equal(state.requests.length, 0);
});

test('a live Freighter passphrase change is rejected before the wallet store catches up', async () => {
  state.sign = async () => {
    state.live = { ...state.live, networkPassphrase: 'A different network' };
    return SIGNATURE;
  };
  await assert.rejects(bundle.webhookApi.list(context()), /wallet or network changed/);
  assert.equal(state.requests.length, 0);
});

test('invalid registration URLs never open a signing prompt', () => {
  for (const url of ['http://seller.example', 'https://user:password@seller.example', 'https://seller.example/#fragment']) {
    assert.throws(() => bundle.webhookApi.register(context(), url, ['invoice.paid']), /HTTPS URL/);
  }
  assert.equal(state.signed.length, 0);
  assert.equal(state.requests.length, 0);
});

test('the panel loads only on demand, shows a secret once, rotates, tests and removes an endpoint', async () => {
  const { container, unmount } = await render(React.createElement(bundle.SellerWebhooksPanel));
  try {
    assert.equal(state.signed.length, 0, 'mounting does not open Freighter');
    await click(container, 'Load endpoints');
    assert.match(container.textContent, /seller\.example\/hooks/);
    await submitUrl(container, 'https://seller.example/hooks');
    assert.equal(container.querySelector('#webhook-signing-secret').value, SECRET);
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        assert.doesNotMatch(storage.getItem(storage.key(index)) || '', /whsec_/);
      }
    }
    await click(container, "I've saved it");
    assert.equal(container.querySelector('#webhook-signing-secret'), null);
    await click(container, 'Rotate secret');
    assert.equal(container.querySelector('#webhook-signing-secret').value, SECRET);
    await click(container, "I've saved it");
    await click(container, 'Send test event');
    assert.match(container.textContent, /Test event queued: test-event/);
    await click(container, 'Remove');
    assert.equal(state.requests.filter((item) => item.path.endsWith('/remove')).length, 0);
    await click(container, 'Confirm removal');
    assert.match(container.textContent, /No endpoints registered/);
  } finally { unmount(); }
});

test('a late secret response is discarded after switching wallets', async () => {
  const response = deferred();
  const started = deferred();
  let signal;
  state.post = (requestPath, body, options) => {
    signal = options.signal;
    started.resolve();
    return response.promise;
  };
  const { container, unmount } = await render(React.createElement(bundle.SellerWebhooksPanel));
  try {
    await submitUrl(container, 'https://old-seller.example/hooks');
    await started.promise;
    await React.act(async () => { wallet(BOB); });
    assert.equal(signal.aborted, true);
    await React.act(async () => {
      response.resolve({ data: { success: true, data: { endpoint: ENDPOINT, secret: SECRET } } });
    });
    assert.equal(container.querySelector('#webhook-signing-secret'), null);
    assert.doesNotMatch(container.textContent, /old-seller|seller\.example\/hooks|whsec_/);
    assert.equal(container.querySelector('#webhook-url').value, '');
  } finally { unmount(); }
});

test.after(() => { delete globalThis.__webhookTest; });
