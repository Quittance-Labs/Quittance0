const test = require('node:test');
const assert = require('node:assert/strict');
const {
  INVOICE_DRAFT_STORAGE_KEY,
  saveInvoiceDraft,
  loadInvoiceDraft,
  clearInvoiceDraft,
} = require('../lib/invoice-draft.js');
const { walletGate } = require('../lib/freighter-availability.js');

class MockStorage {
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
}

test('invoice draft: preserves non-secret fields in sessionStorage', () => {
  const originalWindow = global.window;
  const mockStorage = new MockStorage();
  global.window = { sessionStorage: mockStorage };

  try {
    const draftData = {
      amount: '42.50',
      assetCode: 'USDC',
      description: 'Consulting services for September',
      sellerName: 'Alice Seller',
      sellerEmail: 'alice@example.com',
      customerName: 'Bob Customer',
      customerEmail: 'bob@example.com',
      expiresInDays: 14,
    };

    saveInvoiceDraft(draftData);

    const loaded = loadInvoiceDraft();
    assert.deepEqual(loaded, draftData);
  } finally {
    global.window = originalWindow;
  }
});

test('invoice draft: strictly ignores secrets, private keys, or tokens', () => {
  const originalWindow = global.window;
  const mockStorage = new MockStorage();
  global.window = { sessionStorage: mockStorage };

  try {
    const draftWithSecrets = {
      amount: '100',
      assetCode: 'XLM',
      description: 'Design sprint',
      secretKey: 'SDEXAMPLESECRETKEYDONOTSTORE',
      privateKey: 'PVT_EXAMPLE_SECRET',
      token: 'jwt.token.here',
      signer: 'GSELLER...',
    };

    saveInvoiceDraft(draftWithSecrets);

    const raw = JSON.parse(mockStorage.getItem(INVOICE_DRAFT_STORAGE_KEY));
    assert.equal(raw.amount, '100');
    assert.equal(raw.assetCode, 'XLM');
    assert.equal(raw.description, 'Design sprint');
    assert.equal(raw.secretKey, undefined);
    assert.equal(raw.privateKey, undefined);
    assert.equal(raw.token, undefined);
    assert.equal(raw.signer, undefined);

    const loaded = loadInvoiceDraft();
    assert.equal(loaded.secretKey, undefined);
    assert.equal(loaded.privateKey, undefined);
  } finally {
    global.window = originalWindow;
  }
});

test('invoice draft: clearInvoiceDraft deletes stored draft from storage', () => {
  const originalWindow = global.window;
  const mockStorage = new MockStorage();
  global.window = { sessionStorage: mockStorage };

  try {
    saveInvoiceDraft({ amount: '500', assetCode: 'XLM' });
    assert.ok(mockStorage.getItem(INVOICE_DRAFT_STORAGE_KEY));

    clearInvoiceDraft();
    assert.equal(mockStorage.getItem(INVOICE_DRAFT_STORAGE_KEY), null);
    assert.equal(loadInvoiceDraft(), null);
  } finally {
    global.window = originalWindow;
  }
});

test('invoice draft: safely handles missing window or broken storage without throwing', () => {
  const originalWindow = global.window;

  // SSR environment (no window)
  delete global.window;
  assert.doesNotThrow(() => {
    saveInvoiceDraft({ amount: '100' });
    assert.equal(loadInvoiceDraft(), null);
    clearInvoiceDraft();
  });

  // Restricted iframe / throwing storage
  global.window = {
    get sessionStorage() {
      throw new Error('SecurityError: Access is denied');
    },
  };

  assert.doesNotThrow(() => {
    saveInvoiceDraft({ amount: '100' });
    assert.equal(loadInvoiceDraft(), null);
    clearInvoiceDraft();
  });

  global.window = originalWindow;
});

test('invoice draft: preserves fields across wallet disconnect, wrong network, and reconnect lifecycle', () => {
  const originalWindow = global.window;
  const mockStorage = new MockStorage();
  global.window = { sessionStorage: mockStorage };

  try {
    const SELLER_WALLET = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

    // 1. User starts filling out the form while connected to TESTNET
    const activeDraft = {
      amount: '250.00',
      assetCode: 'XLM',
      description: 'Audit report and remediation',
      customerEmail: 'client@company.org',
    };
    saveInvoiceDraft(activeDraft);

    let session = {
      freighterAvailable: true,
      connected: true,
      publicKey: SELLER_WALLET,
      network: 'TESTNET',
    };
    let gate = walletGate(session, 'TESTNET');
    assert.equal(gate.ready, true);
    assert.equal(gate.status, 'ready');

    // 2. Mid-form, user disconnects or locks Freighter extension
    session = {
      freighterAvailable: true,
      connected: false,
      publicKey: null,
      network: null,
    };
    gate = walletGate(session, 'TESTNET');
    assert.equal(gate.ready, false);
    assert.equal(gate.status, 'disconnected');
    assert.equal(gate.action, 'connect');

    // Draft fields MUST remain intact
    let preservedDraft = loadInvoiceDraft();
    assert.deepEqual(preservedDraft, activeDraft);

    // 3. User reconnects Freighter on the WRONG network (e.g., PUBLIC)
    session = {
      freighterAvailable: true,
      connected: true,
      publicKey: SELLER_WALLET,
      network: 'PUBLIC',
    };
    gate = walletGate(session, 'TESTNET');
    assert.equal(gate.ready, false);
    assert.equal(gate.status, 'wrong_network');
    assert.equal(gate.action, 'switch_network');

    // Draft fields MUST still remain intact
    preservedDraft = loadInvoiceDraft();
    assert.deepEqual(preservedDraft, activeDraft);

    // 4. User switches back to expected TESTNET network
    session = {
      freighterAvailable: true,
      connected: true,
      publicKey: SELLER_WALLET,
      network: 'TESTNET',
    };
    gate = walletGate(session, 'TESTNET');
    assert.equal(gate.ready, true);
    assert.equal(gate.status, 'ready');
    assert.equal(gate.action, 'none');

    // Draft fields MUST still be intact and ready for submission
    preservedDraft = loadInvoiceDraft();
    assert.deepEqual(preservedDraft, activeDraft);

    // 5. Successful submission clears the draft
    clearInvoiceDraft();
    assert.equal(loadInvoiceDraft(), null);
  } finally {
    global.window = originalWindow;
  }
});
