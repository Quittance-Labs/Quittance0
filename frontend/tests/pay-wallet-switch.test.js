const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');

const { loadBundle, installDom, render } = require('./support/a11y-harness');

installDom();
const bundle = loadBundle();

const ALICE = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const BOB = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

function setWallet(overrides) {
  bundle.useWalletStore.setState({
    publicKey: null,
    balance: '0',
    connected: false,
    network: null,
    networkPassphrase: null,
    freighterAvailable: undefined,
    ...overrides,
  });
}

function walletOnTestnet(publicKey) {
  setWallet({
    publicKey,
    balance: '100.00',
    connected: true,
    network: 'TESTNET',
    networkPassphrase: TESTNET_PASSPHRASE,
    freighterAvailable: true,
  });
}

function setupFreighterReady() {
  bundle.setWalletConnectionStub(async () => true);
  bundle.setWalletAccessStub(async () => true);
}

function teardownFreighterReady() {
  bundle.resetWalletConnectionStub();
  bundle.resetWalletAccessStub();
  bundle.resetSendPaymentStub();
  bundle.resetResponses();
  setWallet({});
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

test('PaymentButton aborts in-flight signing if wallet switches during signing', async () => {
  walletOnTestnet(ALICE);
  setupFreighterReady();

  let resolveSendPayment = null;
  bundle.setSendPaymentStub(() => {
    return new Promise((resolve) => {
      resolveSendPayment = resolve;
    });
  });

  const successes = [];
  const errors = [];

  const { container, unmount } = await render(
    React.createElement(bundle.PaymentButton, {
      destination: ALICE,
      amount: '10',
      memo: 'QTN-101',
      assetCode: 'XLM',
      invoiceId: 'inv_101',
      invoiceStatus: 'PENDING',
      onSuccess: (txHash) => successes.push(txHash),
      onError: (msg) => errors.push(msg),
    })
  );

  try {
    const button = container.querySelector('button');
    assert.ok(button);
    button.click();
    await settle();

    bundle.useWalletStore.setState({ publicKey: BOB });
    await settle();

    if (resolveSendPayment) {
      resolveSendPayment('hash_from_alice');
    }
    await settle();

    assert.equal(successes.length, 0);
    assert.equal(errors.length, 0);
  } finally {
    teardownFreighterReady();
    unmount();
  }
});

test('PaymentButton aborts in-flight verification if wallet switches during verify call', async () => {
  walletOnTestnet(ALICE);
  setupFreighterReady();

  let capturedSignal = null;
  let resolveVerify = null;

  bundle.setSendPaymentStub(async () => 'hash_alice_123');
  bundle.setResponse('/invoices/inv_102/verify', (config) => {
    capturedSignal = config?.signal;
    return new Promise((resolve) => {
      resolveVerify = resolve;
    });
  });

  const successes = [];
  const errors = [];

  const { container, unmount } = await render(
    React.createElement(bundle.PaymentButton, {
      destination: ALICE,
      amount: '10',
      memo: 'QTN-102',
      assetCode: 'XLM',
      invoiceId: 'inv_102',
      invoiceStatus: 'PENDING',
      onSuccess: (txHash) => successes.push(txHash),
      onError: (msg) => errors.push(msg),
    })
  );

  try {
    const button = container.querySelector('button');
    assert.ok(button);
    button.click();
    await settle();

    assert.ok(resolveVerify !== null);
    bundle.useWalletStore.setState({ publicKey: BOB });
    await settle();

    if (capturedSignal) {
      assert.equal(capturedSignal.aborted, true);
    }

    resolveVerify({ data: { success: true, invoice: { status: 'PAID' } } });
    await settle();

    assert.equal(successes.length, 0);
    assert.equal(errors.length, 0);
  } finally {
    teardownFreighterReady();
    unmount();
  }
});

test('PaymentButton aborts in-flight verification if wallet disconnects during verify call', async () => {
  walletOnTestnet(ALICE);
  setupFreighterReady();

  let capturedSignal = null;
  let resolveVerify = null;

  bundle.setSendPaymentStub(async () => 'hash_alice_456');
  bundle.setResponse('/invoices/inv_103/verify', (config) => {
    capturedSignal = config?.signal;
    return new Promise((resolve) => {
      resolveVerify = resolve;
    });
  });

  const successes = [];
  const errors = [];

  const { container, unmount } = await render(
    React.createElement(bundle.PaymentButton, {
      destination: ALICE,
      amount: '10',
      memo: 'QTN-103',
      assetCode: 'XLM',
      invoiceId: 'inv_103',
      invoiceStatus: 'PENDING',
      onSuccess: (txHash) => successes.push(txHash),
      onError: (msg) => errors.push(msg),
    })
  );

  try {
    const button = container.querySelector('button');
    assert.ok(button);
    button.click();
    await settle();

    assert.ok(resolveVerify !== null);
    bundle.useWalletStore.setState({ connected: false, publicKey: null });
    await settle();

    if (capturedSignal) {
      assert.equal(capturedSignal.aborted, true);
    }

    resolveVerify({ data: { success: true, invoice: { status: 'PAID' } } });
    await settle();

    assert.equal(successes.length, 0);
    assert.equal(errors.length, 0);
  } finally {
    teardownFreighterReady();
    unmount();
  }
});

test('PaymentButton completes successfully when wallet remains connected with same key', async () => {
  walletOnTestnet(ALICE);
  setupFreighterReady();

  bundle.setSendPaymentStub(async () => 'hash_alice_success');
  bundle.setResponse('/invoices/inv_104/verify', {
    success: true,
    invoice: { status: 'PAID' },
  });

  const successes = [];
  const errors = [];

  const { container, unmount } = await render(
    React.createElement(bundle.PaymentButton, {
      destination: ALICE,
      amount: '10',
      memo: 'QTN-104',
      assetCode: 'XLM',
      invoiceId: 'inv_104',
      invoiceStatus: 'PENDING',
      onSuccess: (txHash) => successes.push(txHash),
      onError: (msg) => errors.push(msg),
    })
  );

  try {
    const button = container.querySelector('button');
    assert.ok(button);
    button.click();
    await settle();

    assert.deepEqual(successes, ['hash_alice_success']);
    assert.equal(errors.length, 0);
  } finally {
    teardownFreighterReady();
    unmount();
  }
});
