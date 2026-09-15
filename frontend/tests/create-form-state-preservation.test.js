const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INVOICE_DRAFT_STORAGE_KEY,
  saveInvoiceDraft,
  loadInvoiceDraft,
  clearInvoiceDraft,
} = require('../lib/invoice-draft.ts');

class MockSessionStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
  get length() {
    return this.store.size;
  }
}

test.beforeEach(() => {
  global.window = {
    sessionStorage: new MockSessionStorage(),
  };
});

test.afterEach(() => {
  delete global.window;
});

test('INVOICE_DRAFT_STORAGE_KEY is quittance_invoice_create_draft_v1', () => {
  assert.equal(INVOICE_DRAFT_STORAGE_KEY, 'quittance_invoice_create_draft_v1');
});

test('saveInvoiceDraft stores valid non-secret form fields', () => {
  const draft = {
    amount: '100.5',
    assetCode: 'xlm',
    description: 'Services rendered',
    sellerName: 'Alice Corp',
    sellerEmail: 'alice@example.com',
    customerName: 'Bob Ltd',
    customerEmail: 'bob@example.com',
    expiresInDays: 14,
  };

  saveInvoiceDraft(draft);
  const loaded = loadInvoiceDraft();

  assert.deepEqual(loaded, {
    amount: '100.5',
    assetCode: 'XLM',
    description: 'Services rendered',
    sellerName: 'Alice Corp',
    sellerEmail: 'alice@example.com',
    customerName: 'Bob Ltd',
    customerEmail: 'bob@example.com',
    expiresInDays: 14,
  });
});

test('saveInvoiceDraft ignores secrets and private keys', () => {
  const draftWithSecrets = {
    amount: '50',
    assetCode: 'USDC',
    secretKey: 'SDOUBTFULPRIVATEKEYTHATSHOULDNEVERBESAVED',
    token: 'secret-bearer-token',
  };

  saveInvoiceDraft(draftWithSecrets);
  const raw = global.window.sessionStorage.getItem(INVOICE_DRAFT_STORAGE_KEY);
  const parsed = JSON.parse(raw);

  assert.equal(parsed.amount, '50');
  assert.equal(parsed.assetCode, 'USDC');
  assert.equal(parsed.secretKey, undefined);
  assert.equal(parsed.token, undefined);
  assert.equal(raw.includes('secretKey'), false);
  assert.equal(raw.includes('SDOUBTFULPRIVATEKEY'), false);
});

test('saveInvoiceDraft trims whitespace and normalizes asset code', () => {
  saveInvoiceDraft({
    amount: '  250.75  ',
    assetCode: '  usdc  ',
    sellerName: '  Alice  ',
  });

  const loaded = loadInvoiceDraft();
  assert.equal(loaded.amount, '250.75');
  assert.equal(loaded.assetCode, 'USDC');
  assert.equal(loaded.sellerName, '  Alice  '); // preserves inner content of seller name
});

test('saveInvoiceDraft clears key when empty draft is provided', () => {
  saveInvoiceDraft({ amount: '10' });
  assert.notEqual(global.window.sessionStorage.getItem(INVOICE_DRAFT_STORAGE_KEY), null);

  saveInvoiceDraft({});
  assert.equal(global.window.sessionStorage.getItem(INVOICE_DRAFT_STORAGE_KEY), null);
  assert.equal(loadInvoiceDraft(), null);
});

test('clearInvoiceDraft removes draft from sessionStorage', () => {
  saveInvoiceDraft({ amount: '75', assetCode: 'XLM' });
  assert.notEqual(loadInvoiceDraft(), null);

  clearInvoiceDraft();
  assert.equal(loadInvoiceDraft(), null);
  assert.equal(global.window.sessionStorage.getItem(INVOICE_DRAFT_STORAGE_KEY), null);
});

test('handles missing or throwing sessionStorage gracefully', () => {
  // Test when window is undefined
  delete global.window;
  assert.doesNotThrow(() => saveInvoiceDraft({ amount: '10' }));
  assert.equal(loadInvoiceDraft(), null);
  assert.doesNotThrow(() => clearInvoiceDraft());

  // Test when sessionStorage throws (e.g. storage disabled / sandbox iframe)
  global.window = {
    get sessionStorage() {
      throw new Error('Access denied');
    },
  };
  assert.doesNotThrow(() => saveInvoiceDraft({ amount: '10' }));
  assert.equal(loadInvoiceDraft(), null);
  assert.doesNotThrow(() => clearInvoiceDraft());
});

test('form state logic across wallet disconnect, wrong network, and reconnect', () => {
  // Simulate invoice form state model
  const formState = {
    amount: '500',
    assetCode: 'XLM',
    description: 'Design consultation',
    sellerName: 'Acme Studio',
    sellerEmail: 'acme@example.com',
    customerName: 'Client Co',
    customerEmail: 'client@example.com',
    expiresInDays: 30,
  };

  // Helper simulating submit button status and CTA
  function computeSubmitProps(gate, isWrongNetwork, loading) {
    const disabled = loading || !gate.ready || isWrongNetwork;
    let label = 'Create Invoice';
    if (!gate.ready) {
      label = 'Connect Wallet to Create';
    } else if (isWrongNetwork) {
      label = 'Switch Network to Create';
    }
    return { disabled, label };
  }

  // 1. Initial state: Wallet connected on TESTNET
  const initialGate = { status: 'ready', ready: true, network: 'TESTNET', publicKey: 'GCONNECTED...' };
  const initialSubmit = computeSubmitProps(initialGate, false, false);
  assert.equal(initialSubmit.disabled, false);
  assert.equal(initialSubmit.label, 'Create Invoice');

  // Save form progress
  saveInvoiceDraft(formState);

  // 2. Mid-form disconnect / lock happens
  // Wallet gate transitions to disconnected
  const disconnectedGate = { status: 'disconnected', ready: false, network: null, publicKey: null };
  const disconnectedSubmit = computeSubmitProps(disconnectedGate, false, false);

  // Assert: Submit is disabled with clear prompt
  assert.equal(disconnectedSubmit.disabled, true);
  assert.equal(disconnectedSubmit.label, 'Connect Wallet to Create');

  // Assert: Non-wallet form fields are NOT lost or cleared
  assert.equal(formState.amount, '500');
  assert.equal(formState.description, 'Design consultation');
  assert.equal(formState.sellerName, 'Acme Studio');
  assert.deepEqual(loadInvoiceDraft(), {
    amount: '500',
    assetCode: 'XLM',
    description: 'Design consultation',
    sellerName: 'Acme Studio',
    sellerEmail: 'acme@example.com',
    customerName: 'Client Co',
    customerEmail: 'client@example.com',
    expiresInDays: 30,
  });

  // 3. User reconnects but wallet is on PUBLIC network instead of TESTNET
  const wrongNetworkGate = { status: 'ready', ready: true, network: 'PUBLIC', publicKey: 'GCONNECTED...' };
  const wrongNetworkSubmit = computeSubmitProps(wrongNetworkGate, true, false);

  // Assert: Submit remains disabled with network mismatch prompt
  assert.equal(wrongNetworkSubmit.disabled, true);
  assert.equal(wrongNetworkSubmit.label, 'Switch Network to Create');
  assert.equal(formState.amount, '500'); // Still preserved!

  // 4. Wallet switches network to TESTNET (reconnect resolved)
  const reconnectedGate = { status: 'ready', ready: true, network: 'TESTNET', publicKey: 'GCONNECTED...' };
  const reconnectedSubmit = computeSubmitProps(reconnectedGate, false, false);

  // Assert: Submit automatically re-enabled without reloading page
  assert.equal(reconnectedSubmit.disabled, false);
  assert.equal(reconnectedSubmit.label, 'Create Invoice');
  assert.equal(formState.amount, '500');

  // 5. Successful creation cleans up the draft
  clearInvoiceDraft();
  assert.equal(loadInvoiceDraft(), null);
});
