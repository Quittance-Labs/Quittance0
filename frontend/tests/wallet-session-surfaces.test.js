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

const { loadBundle, installDom, getDom, render } = require('./support/a11y-harness');

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

/** React reads `value` through its own setter, so a plain assignment is ignored. */
function setInputValue(element, value) {
  const prototype =
    element.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
  setter.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

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

    // Keep stats so hasAnyInvoices stays true while the filtered list is empty.
    bundle.setResponse('/invoices', { data: [] });
    const paidButton = Array.from(container.querySelectorAll('button')).find(
      (btn) => btn.textContent && btn.textContent.includes('Paid')
    );
    assert.ok(paidButton, 'Paid filter button found');
    paidButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await settle();

    assert.match(container.textContent, /No paid Invoices/);
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
      container.querySelector('input[type="search"]') ||
      container.querySelector('input[placeholder*="Search"]');
    assert.ok(searchInput, 'search input exists');

    setInputValue(searchInput, 'NO_MATCH_XYZ');
    await settle();

    assert.match(container.textContent, /No Matching Invoices/);
    assert.match(container.textContent, /Clear Search/);
  } finally {
    unmount();
  }
});

test('switching wallets clears previous rows before the next fetch resolves', async () => {
  walletOnTestnet(ALICE);
  primeFor([invoice('inv_alice', ALICE, 11.11)]);

  const { container, unmount } = await render(React.createElement(bundle.DashboardPage));
  try {
    await settle();
    assert.match(container.textContent, /11\.11/, "the first seller's row is on screen");

    // Leave the next seller's response unset so the fetch cannot repopulate yet.
    bundle.resetResponses();
    bundle.setResponse('/invoices/stats', {
      data: [{ total_invoices: 0, paid_invoices: 0, pending_invoices: 0 }],
    });
    // Intentionally no /invoices response yet — the previous wallet rows must
    // still disappear on the session change itself.
    bundle.useWalletStore.setState({ publicKey: BOB });
    await settle();

    assert.doesNotMatch(
      container.textContent,
      /11\.11/,
      "the previous seller's row must not remain authoritative after the switch"
    );
  } finally {
    unmount();
  }
});

test('a typed create draft comes back after the form remounts', async () => {
  walletOnTestnet(ALICE);

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

/**
 * Issue #432, at the level a person experiences it: the landing page, not the
 * form component. Freighter locking or disconnecting mid-form must not cost
 * the amount, the description or the client email someone just typed, and
 * reconnecting on the expected network must bring create back without a page
 * reload. Reconnecting on the wrong network must still refuse.
 */
test('a disconnect mid-form keeps the draft and reconnects create without a reload', async () => {
  getDom().window.sessionStorage.clear();
  primeFor([]);
  walletOnTestnet(ALICE);

  // Fill part of the form, then lose the wallet.
  const typing = await render(React.createElement(bundle.HomePage));
  try {
    const amount = typing.container.querySelector('#invoice-amount');
    assert.ok(amount, 'the create form did not render for a ready wallet');
    setInputValue(amount, '25.5');
    setInputValue(typing.container.querySelector('#invoice-description'), 'March design work');
    setInputValue(typing.container.querySelector('#customer-email'), 'ada@example.com');
    await settle();
  } finally {
    typing.unmount();
  }

  setWallet({});
  const disconnected = await render(React.createElement(bundle.HomePage));
  try {
    // Nothing may be created while the wallet is gone, and the page has to say
    // so rather than silently dropping the form.
    assert.equal(
      disconnected.container.querySelector('#invoice-amount'),
      null,
      'the create form stayed usable after the wallet disconnected'
    );
    assert.ok(
      disconnected.container.querySelector('[data-gate-status]'),
      'the page did not explain why create is unavailable'
    );
  } finally {
    disconnected.unmount();
  }

  // Reconnecting on TESTNET restores the fields and makes create available
  // again, in the same page load.
  walletOnTestnet(ALICE);
  const reconnected = await render(React.createElement(bundle.HomePage));
  try {
    const amount = reconnected.container.querySelector('#invoice-amount');
    assert.equal(amount.value, '25.5', 'the typed amount was lost across the disconnect');
    assert.equal(
      reconnected.container.querySelector('#invoice-description').value,
      'March design work',
      'the typed description was lost across the disconnect'
    );
    assert.equal(
      reconnected.container.querySelector('#customer-email').value,
      'ada@example.com',
      'the typed client email was lost across the disconnect'
    );
    assert.equal(
      reconnected.container.querySelector('button[type="submit"]').disabled,
      false,
      'create stayed disabled after reconnecting on the expected network'
    );
  } finally {
    reconnected.unmount();
  }

  // Reconnecting on the wrong network still blocks create, with the existing
  // mismatch UX rather than a form that submits and is refused server-side.
  walletOnPublic(ALICE);
  const wrongNetwork = await render(React.createElement(bundle.HomePage));
  try {
    const gatePrompt = wrongNetwork.container.querySelector('[data-gate-status]');
    assert.ok(gatePrompt, 'the wrong-network state offered no prompt at all');
    assert.equal(gatePrompt.getAttribute('data-gate-status'), 'wrong_network');
    assert.match(gatePrompt.textContent, /Testnet/, 'the prompt does not name the expected network');
    assert.equal(
      wrongNetwork.container.querySelector('#invoice-amount'),
      null,
      'create was offered on a mismatched network'
    );
  } finally {
    wrongNetwork.unmount();
  }

  getDom().window.sessionStorage.clear();
});
