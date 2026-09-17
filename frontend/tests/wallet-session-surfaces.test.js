/**
 * Issue #442 - the create, pay and dashboard surfaces consume one session.
 *
 * The session module's own unit tests cover normalisation, the gate and the
 * change rules. These cases mount the real pages and components through the
 * same harness the accessibility audit uses, so what is asserted is the
 * behaviour a person gets: a mismatch stops the action, and an account switch
 * replaces the previous seller's rows instead of leaving them on screen.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');

const { loadBundle, installDom, render } = require('./support/a11y-harness');

installDom();
const bundle = loadBundle();

const ALICE = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const BOB = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';
const PUBLIC_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

function invoice(id, sellerPublicKey, amount) {
  return {
    id,
    sellerPublicKey,
    amount,
    assetCode: 'XLM',
    memo: 'QTN-' + id,
    status: 'PENDING',
    createdAt: new Date(Date.now() - 3600 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
  };
}

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

function walletOnTestnet(sellerPublicKey) {
  setWallet({
    publicKey: sellerPublicKey,
    balance: '100.00',
    connected: true,
    network: 'TESTNET',
    networkPassphrase: TESTNET_PASSPHRASE,
    freighterAvailable: true,
  });
}

function walletOnPublic(sellerPublicKey) {
  setWallet({
    publicKey: sellerPublicKey,
    balance: '100.00',
    connected: true,
    network: 'PUBLIC',
    networkPassphrase: PUBLIC_PASSPHRASE,
    freighterAvailable: true,
  });
}

function primeFor(rows) {
  bundle.resetResponses();
  bundle.setResponse('/invoices/stats', {
    data: [
      {
        total_invoices: rows.length,
        paid_invoices: 0,
        pending_invoices: rows.length,
      },
    ],
  });
  bundle.setResponse('/invoices', { data: rows });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

test('a network mismatch keeps the dashboard from showing the seller invoices', async () => {
  walletOnPublic(ALICE);
  primeFor([invoice('inv_alice', ALICE, 11.11)]);

  const { container, unmount } = await render(React.createElement(bundle.DashboardPage));
  try {
    await settle();
    assert.doesNotMatch(
      container.textContent,
      /11\.11/,
      'a wallet on the wrong network must not see the invoice list'
    );
  } finally {
    unmount();
  }
});

test('the pay button refuses a mismatched network with the session gate message', async () => {
  walletOnPublic(ALICE);
  let reported = null;

  const { container, unmount } = await render(
    React.createElement(bundle.PaymentButton, {
      destination: ALICE,
      amount: '25',
      memo: 'QTN-pay',
      assetCode: 'XLM',
      invoiceId: 'inv_pay',
      invoiceStatus: 'PENDING',
      onError: (message) => {
        reported = message;
      },
    })
  );

  try {
    const button = container.querySelector('button');
    assert.ok(button, 'the pay button rendered');
    button.click();
    await settle();

    assert.match(
      String(reported || ''),
      /Testnet/,
      'the refusal names the network the app expects'
    );
  } finally {
    unmount();
  }
});

test('the create form does not submit while the network is wrong', async () => {
  walletOnPublic(ALICE);
  const created = [];

  const { container, unmount } = await render(
    React.createElement(bundle.InvoiceForm, {
      userWallet: ALICE,
      onSuccess: (result) => {
        created.push(result);
      },
    })
  );

  try {
    const form = container.querySelector('form');
    assert.ok(form, 'the create form rendered');
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await settle();

    assert.deepEqual(created, [], 'no invoice was created from a mismatched wallet');
  } finally {
    unmount();
  }
});

test('switching accounts replaces the previous seller rows with the new ones', async () => {
  walletOnTestnet(ALICE);
  primeFor([invoice('inv_alice', ALICE, 11.11)]);

  const { container, unmount } = await render(React.createElement(bundle.DashboardPage));
  try {
    await settle();
    assert.match(container.textContent, /11\.11/, "the first seller's row is on screen");

    primeFor([invoice('inv_bob', BOB, 22.22)]);
    bundle.useWalletStore.setState({ publicKey: BOB });
    await settle();

    assert.doesNotMatch(
      container.textContent,
      /11\.11/,
      "the previous seller's row is gone"
    );
    assert.match(container.textContent, /22\.22/, "the new seller's row is on screen");
  } finally {
    unmount();
  }
});

test('disconnecting hides the seller rows and asks for a wallet', async () => {
  walletOnTestnet(ALICE);
  primeFor([invoice('inv_alice', ALICE, 11.11)]);

  const { container, unmount } = await render(React.createElement(bundle.DashboardPage));
  try {
    await settle();
    assert.match(container.textContent, /11\.11/);

    setWallet({});
    await settle();

    assert.doesNotMatch(container.textContent, /11\.11/, 'rows are hidden once disconnected');
    assert.ok(
      container.querySelector('[data-gate-status]'),
      'the page asks the wallet to connect or install Freighter'
    );
  } finally {
    unmount();
  }
});

test('a typed create draft comes back after the form remounts', async () => {
  walletOnTestnet(ALICE);

  const setInputValue = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    setter.call(element, value);
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };

  const first = await render(React.createElement(bundle.InvoiceForm, { userWallet: ALICE }));
  try {
    const amountInput = first.container.querySelector('#invoice-amount');
    assert.ok(amountInput, 'the amount field rendered');
    setInputValue(amountInput, '25.5');
    await settle();
  } finally {
    first.unmount();
  }

  // The page unmounts the form whenever the wallet gate drops; the next mount
  // is what a person sees after reconnecting.
  const second = await render(React.createElement(bundle.InvoiceForm, { userWallet: ALICE }));
  try {
    await settle();
    const restored = second.container.querySelector('#invoice-amount');
    assert.equal(restored.value, '25.5', 'the typed amount survived the remount');
  } finally {
    second.unmount();
  }
});

test('renders zero-invoice state when wallet has no invoices', async () => {
  walletOnTestnet(ALICE);
  primeFor([]);

  const { container, unmount } = await render(React.createElement(bundle.DashboardPage));
  try {
    await settle();
    assert.match(container.textContent, /No Invoices Yet/);
    assert.match(container.textContent, /Create Invoice/);
  } finally {
    unmount();
  }
});

test('renders status filtered-empty state when no invoices match filter', async () => {
  walletOnTestnet(ALICE);
  primeFor([invoice('inv_alice', ALICE, 11.11)]);

  const { container, unmount } = await render(React.createElement(bundle.DashboardPage));
  try {
    await settle();
    assert.match(container.textContent, /11\.11/);

    bundle.setResponse('/invoices', { data: [] });
    const paidButton = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent.includes('Paid')
    );
    assert.ok(paidButton, 'Paid filter button found');
    paidButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    assert.match(container.textContent, /No Paid Invoices/);
    assert.match(container.textContent, /Show All Invoices/);
  } finally {
    unmount();
  }
});

test('renders search filtered-empty state when search produces no matches', async () => {
  walletOnTestnet(ALICE);
  primeFor([invoice('inv_alice', ALICE, 11.11)]);

  const { container, unmount } = await render(React.createElement(bundle.DashboardPage));
  try {
    await settle();
    assert.match(container.textContent, /11\.11/);

    const searchInput =
      container.querySelector('input[type="text"]') ||
      container.querySelector('input[placeholder*="Search"]');
    assert.ok(searchInput, 'search input exists');

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    setter.call(searchInput, 'NO_MATCH_XYZ');
    searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle();

    assert.match(container.textContent, /No Matching Invoices/);
    assert.match(container.textContent, /Clear Search/);
  } finally {
    unmount();
  }
});
