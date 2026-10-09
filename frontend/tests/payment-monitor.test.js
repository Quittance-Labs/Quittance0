/**
 * Wallet stream parity for issue #585. The real TS modules are compiled with
 * the existing esbuild dependency; only Horizon, Freighter and toast I/O are
 * replaced. No transaction is submitted and no wallet is contacted.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SELLER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const BUYER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const USDC_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';

function sourceLoader(aliases) {
  const cache = new Map();
  function load(file) {
    if (!fs.existsSync(file)) file += '.ts';
    if (cache.has(file)) return cache.get(file).exports;
    const compiled = new Module(file, module);
    compiled.filename = file;
    compiled.paths = Module._nodeModulePaths(path.dirname(file));
    cache.set(file, compiled);
    compiled.require = (specifier) => {
      if (Object.hasOwn(aliases, specifier)) return aliases[specifier];
      if (specifier === '@shared/network') return load(path.join(ROOT, '../shared/network.ts'));
      if (specifier.startsWith('.')) return load(path.resolve(path.dirname(file), specifier));
      return require(specifier);
    };
    const result = esbuild.transformSync(fs.readFileSync(file, 'utf8'), {
      loader: file.endsWith('.tsx') ? 'tsx' : 'ts',
      format: 'cjs',
      jsx: 'automatic',
      target: 'es2020',
      sourcefile: file,
    });
    compiled._compile(result.code, file);
    return compiled.exports;
  }
  return load;
}

function harness() {
  const state = { streams: [], toasts: [], lookups: [], lookup: async () => ({ memo: 'INV-585' }) };
  const horizon = {
    payments() {
      const stream = { account: null, cursor: null, closed: false };
      return {
        forAccount(account) { stream.account = account; return this; },
        cursor(cursor) { stream.cursor = cursor; return this; },
        stream(handlers) {
          Object.assign(stream, handlers);
          state.streams.push(stream);
          return () => { stream.closed = true; };
        },
      };
    },
    transactions() {
      return {
        transaction(hash) {
          return {
            call() { state.lookups.push(hash); return state.lookup(hash); },
          };
        },
      };
    },
  };
  const load = sourceLoader({
    '@stellar/stellar-sdk': { Horizon: { Server: class { constructor() { return horizon; } } } },
    '@stellar/freighter-api': {},
    './freighter-availability': {},
    './network-display-name': { networkDisplayName: () => 'Testnet' },
    './trustline-preflight': {},
    '@shared/memo': {},
    sonner: {
      toast: {
        success: (title, options) => state.toasts.push({ title, options }),
        error: (title, options) => state.toasts.push({ title, options }),
      },
    },
  });
  return {
    state,
    stellar: load(path.join(ROOT, 'lib/stellar.ts')),
    monitor: load(path.join(ROOT, 'lib/payment-monitor.ts')).paymentMonitor,
    receivedToasts: () => state.toasts.filter((entry) => entry.title === 'Payment Received!'),
  };
}

function payment(type, overrides = {}) {
  return {
    id: 'operation-585',
    type,
    transaction_hash: 'a'.repeat(64),
    transaction_successful: true,
    from: BUYER,
    to: SELLER,
    amount: '12.5000000',
    asset_type: 'credit_alphanum4',
    asset_code: 'USDC',
    asset_issuer: USDC_ISSUER,
    source_amount: '99.0000000',
    source_asset_type: 'native',
    created_at: '2026-10-01T12:00:00Z',
    ...overrides,
  };
}

test('account stream recognizes all accepted payment shapes and preserves destination fields', () => {
  const h = harness();
  const seen = [];
  const close = h.stellar.streamPayments(SELLER, (record) => seen.push(record));
  const records = ['payment', 'path_payment_strict_receive', 'path_payment_strict_send'].map((type) => payment(type));
  for (const record of records) h.state.streams[0].onmessage(record);
  for (const type of ['create_claimable_balance', 'account_merge', 'create_account']) {
    h.state.streams[0].onmessage(payment(type));
  }
  h.state.streams[0].onmessage(payment('path_payment_strict_send', { transaction_successful: false }));
  assert.deepEqual(seen, records);
  assert.equal(seen[2], records[2], 'forward the original destination-side record');
  assert.equal(seen[2].amount, '12.5000000');
  assert.equal(seen[2].asset_code, 'USDC');
  assert.equal(h.state.streams[0].cursor, 'now');
  close();
  assert.equal(h.state.streams[0].closed, true);
});

for (const type of ['payment', 'path_payment_strict_receive', 'path_payment_strict_send']) {
  test(`${type}: an incoming operation emits one received toast and destination-side notification`, async () => {
    const h = harness();
    const received = [];
    h.monitor.startMonitoring(SELLER, (record) => received.push(record));
    await h.state.streams[0].onmessage(payment(type));
    assert.equal(received.length, 1);
    assert.equal(received[0].amount, '12.5000000');
    assert.equal(received[0].assetCode, 'USDC');
    assert.equal(received[0].to, SELLER);
    assert.equal(received[0].memo, 'INV-585');
    assert.equal(h.receivedToasts().length, 1);
    assert.match(h.receivedToasts()[0].options.description, /12\.5000000 USDC/);
    assert.doesNotMatch(h.receivedToasts()[0].options.description, /99|XLM/);
    h.monitor.stopAll();
  });
}

test('concurrent and later replay of the same operation do not duplicate memo fetches or toasts', async () => {
  const h = harness();
  let finish;
  h.state.lookup = () => new Promise((resolve) => { finish = resolve; });
  const received = [];
  h.monitor.startMonitoring(SELLER, (record) => received.push(record));
  const record = payment('path_payment_strict_send');
  const first = h.state.streams[0].onmessage(record);
  const replay = h.state.streams[0].onmessage(record);
  assert.equal(h.state.lookups.length, 1);
  assert.equal(h.receivedToasts().length, 0);
  finish({ memo: 'INV-585' });
  await Promise.all([first, replay]);
  await h.state.streams[0].onmessage(record);
  assert.equal(h.state.lookups.length, 1);
  assert.equal(received.length, 1);
  assert.equal(h.receivedToasts().length, 1);
  h.monitor.stopAll();
});

test('outgoing, failed and non-payment operations never trigger received notifications', async () => {
  const h = harness();
  const received = [];
  h.monitor.startMonitoring(SELLER, (record) => received.push(record));
  const records = [
    payment('path_payment_strict_send', { to: BUYER, from: SELLER }),
    payment('path_payment_strict_receive', { transaction_successful: false }),
    payment('create_claimable_balance'),
    payment('account_merge'),
    payment('create_account'),
  ];
  for (const record of records) await h.state.streams[0].onmessage(record);
  assert.equal(h.state.lookups.length, 0);
  assert.deepEqual(received, []);
  assert.deepEqual(h.receivedToasts(), []);
  h.monitor.stopAll();
});

test('stopping a wallet during the memo lookup suppresses the stale received notification', async () => {
  const h = harness();
  let finish;
  h.state.lookup = () => new Promise((resolve) => { finish = resolve; });
  const received = [];
  h.monitor.startMonitoring(SELLER, (record) => received.push(record));
  const processing = h.state.streams[0].onmessage(payment('path_payment_strict_send'));
  h.monitor.stopMonitoring(SELLER);
  finish({ memo: 'INV-585' });
  await processing;
  assert.deepEqual(received, []);
  assert.deepEqual(h.receivedToasts(), []);
  assert.equal(h.monitor.isMonitoring(SELLER), false);
});

test('claimable balance feed shows its identity and claim hint without confirming payment', async () => {
  const React = require('react');
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const previous = new Map();
  for (const name of ['window', 'document', 'navigator']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
  }
  previous.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const calls = [];
  const event = {
    id: 'event-585',
    eventType: 'CLAIMABLE_BALANCE_RECEIVED',
    eventData: { balanceId: 'balance-585', amount: '12.5000000', asset: `USDC:${USDC_ISSUER}`, predicate: { unconditional: true } },
    createdAt: '2026-10-01T12:00:00Z',
  };
  const load = sourceLoader({
    '@/lib/api': { invoiceApi: { getPaymentEvents: async (...args) => { calls.push(args); return { data: [event] }; } } },
    '@/lib/utils': { formatDate: (value) => value },
  });
  const Feed = load(path.join(ROOT, 'components/PaymentEventsFeed.tsx')).default;
  const { createRoot } = require('react-dom/client');
  const container = dom.window.document.getElementById('root');
  const root = createRoot(container);
  try {
    await React.act(async () => { root.render(React.createElement(Feed, { invoiceId: 'inv-585', sellerPublicKey: SELLER })); });
    assert.deepEqual(calls, [['inv-585', SELLER]]);
    assert.match(container.textContent, /Claimable balance received/);
    assert.match(container.textContent, /12\.5000000 USDC:/);
    assert.match(container.textContent, /Balance balance-585/);
    assert.match(container.textContent, /Claim this balance/);
    assert.match(container.textContent, /invoice remains pending/);
    assert.doesNotMatch(container.textContent, /Payment confirmed/);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
