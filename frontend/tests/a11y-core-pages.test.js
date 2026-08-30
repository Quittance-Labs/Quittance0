/**
 * Accessibility audit for the core pages (issue #289).
 *
 * Three layers, because no single one of them covers the requirement:
 *
 *  1. **axe over the real pages and components.** `tests/support/a11y-harness.js`
 *     bundles the shipped `.tsx` and mounts it in jsdom, so this audits what
 *     users get rather than a fixture that resembles it.
 *
 *  2. **Focus and live-region assertions.** axe cannot tell whether focus moved
 *     when a verification finished — it inspects a snapshot, and this is a
 *     behaviour over time. The pay page's result panel is driven through its
 *     states and focus is asserted directly.
 *
 *  3. **Contrast arithmetic.** jsdom performs no layout and resolves no
 *     stylesheet, so axe's `color-contrast` rule cannot return a verdict and is
 *     switched off in the harness. The declared pairs in `tailwind.config.js`
 *     are recomputed here instead, which is the part that can be checked
 *     without a browser.
 *
 * What this does not cover: anything requiring real layout — reflow, target
 * size, focus-visible rendering — and the judgement calls of a manual audit.
 * Those stay a human review.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  loadBundle,
  installDom,
  getDom,
  render,
  auditElement,
  formatViolations,
} = require('./support/a11y-harness');

const {
  MAIN_CONTENT_ID,
  PAYMENT_RESULT_ID,
  statusText,
  statusBadgeLabel,
  describeAmount,
} = require('../lib/a11y');

const { PAY_STATES, initialPaymentState, paymentReducer } = require('../lib/payment-page-state');

const ROOT = path.resolve(__dirname, '..');

installDom();

const React = require('react');
const bundle = loadBundle();

/** Every status the backend can return. */
const ALL_STATUSES = ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'];

const SELLER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';

/** A representative invoice; `overrides` selects the state under audit. */
function invoiceFixture(overrides = {}) {
  return {
    id: 'inv_a11y_fixture',
    amount: 125.5,
    assetCode: 'XLM',
    description: 'Design work, March',
    customerName: 'Ada Lovelace',
    customerEmail: 'ada@example.com',
    sellerName: 'Quittance Labs',
    sellerEmail: 'billing@example.com',
    sellerPublicKey: SELLER,
    payerPublicKey: SELLER,
    payerName: 'Ada Lovelace',
    payerEmail: 'ada@example.com',
    memo: 'QT-A11Y-01',
    status: 'PENDING',
    paymentTxHash: 'a'.repeat(64),
    createdAt: '2026-03-01T10:00:00.000Z',
    expiresAt: '2099-03-08T10:00:00.000Z',
    paidAt: '2026-03-02T12:30:00.000Z',
    ...overrides,
  };
}

/**
 * Registers the API payloads a page render will ask for.
 *
 * The bodies carry the backend's `{ data }` envelope, because `lib/api.ts` is
 * the real module here and unwraps exactly one level.
 */
function primeApi(invoice, invoices = [invoice]) {
  bundle.resetResponses();
  bundle.setResponse('/invoices/stats', {
    data: [{ total_invoices: 3, paid_invoices: 1, pending_invoices: 2 }],
  });
  bundle.setResponse(`/invoices/${invoice.id}/payment-info`, {
    data: { paymentUrl: `https://quittance.test/pay/${invoice.id}` },
  });
  bundle.setResponse(`/invoices/${invoice.id}`, { data: invoice });
  bundle.setResponse('/invoices', { data: invoices });
}

/** Fails with the full axe report rather than a bare count. */
function assertNoViolations(violations, label) {
  assert.equal(
    violations.length,
    0,
    `${label} has ${violations.length} axe violation(s):\n${formatViolations(violations)}`
  );
}

// ---------------------------------------------------------------------------
// 1. axe over the core routes
// ---------------------------------------------------------------------------

test('the landing page, including the invoice form, is axe-clean', async () => {
  primeApi(invoiceFixture());
  bundle.useWalletStore.setState({ publicKey: SELLER, balance: '100.00', connected: true });

  const violations = await auditElement(React.createElement(bundle.HomePage));
  assertNoViolations(violations, 'landing page (wallet connected)');
});

test('the landing page is axe-clean before a wallet is connected', async () => {
  primeApi(invoiceFixture());
  bundle.useWalletStore.setState({ publicKey: null, balance: '0.00', connected: false });

  const violations = await auditElement(React.createElement(bundle.HomePage));
  assertNoViolations(violations, 'landing page (disconnected)');
});

test('the dashboard is axe-clean with invoices in every status', async () => {
  const invoices = ALL_STATUSES.map((status, index) =>
    invoiceFixture({ id: `inv_${index}`, status })
  );
  primeApi(invoiceFixture(), invoices);
  bundle.useWalletStore.setState({ publicKey: SELLER, balance: '100.00', connected: true });

  const violations = await auditElement(React.createElement(bundle.DashboardPage));
  assertNoViolations(violations, 'dashboard');
});

test('the dashboard is axe-clean in its disconnected state', async () => {
  primeApi(invoiceFixture(), []);
  bundle.useWalletStore.setState({ publicKey: null, balance: '0.00', connected: false });

  const violations = await auditElement(React.createElement(bundle.DashboardPage));
  assertNoViolations(violations, 'dashboard (disconnected)');
});

test('the pay page is axe-clean in every invoice status', async () => {
  bundle.useWalletStore.setState({ publicKey: null, balance: '0.00', connected: false });

  for (const status of ALL_STATUSES) {
    const invoice = invoiceFixture({
      status,
      // A pending invoice that already has a hash hides the payment controls,
      // so the controls themselves would never be audited.
      paymentTxHash: status === 'PENDING' ? undefined : 'a'.repeat(64),
    });
    primeApi(invoice);

    const violations = await auditElement(React.createElement(bundle.PayPage));
    assertNoViolations(violations, `pay page (${status})`);
  }
});

test('the invoice detail page is axe-clean in every invoice status', async () => {
  bundle.useWalletStore.setState({ publicKey: null, balance: '0.00', connected: false });

  for (const status of ALL_STATUSES) {
    const invoice = invoiceFixture({ status });
    primeApi(invoice);

    const violations = await auditElement(React.createElement(bundle.InvoiceDetailPage));
    assertNoViolations(violations, `invoice detail page (${status})`);
  }
});

test('an invoice card is axe-clean in every status, with and without a client email', async () => {
  for (const status of ALL_STATUSES) {
    for (const customerEmail of ['ada@example.com', undefined]) {
      const invoice = invoiceFixture({ status, customerEmail });
      const violations = await auditElement(
        React.createElement(bundle.InvoiceCard, { invoice })
      );
      assertNoViolations(violations, `invoice card (${status}, email: ${Boolean(customerEmail)})`);
    }
  }
});

test('the payment receipt is axe-clean without a client email to send it to', async () => {
  const invoice = invoiceFixture({ status: 'PAID', customerEmail: undefined });
  const violations = await auditElement(
    React.createElement(bundle.PaymentReceipt, { invoice })
  );
  assertNoViolations(violations, 'payment receipt (no client email)');
});

test('the standalone status panel is axe-clean in every status', async () => {
  for (const status of ALL_STATUSES) {
    const violations = await auditElement(
      React.createElement(bundle.PaymentStatus, { status, txHash: 'a'.repeat(64) })
    );
    assertNoViolations(violations, `payment status (${status})`);
  }
});

// ---------------------------------------------------------------------------
// 2. Names, labels and roles
// ---------------------------------------------------------------------------

test('every invoice form control has an associated visible label', async () => {
  const { container, unmount } = await render(React.createElement(bundle.InvoiceForm, {}));

  try {
    const controls = container.querySelectorAll('input, select, textarea');
    assert.ok(controls.length >= 6, 'expected the full invoice form to render');

    for (const control of controls) {
      assert.ok(control.id, `a ${control.tagName.toLowerCase()} rendered without an id`);

      const label = container.querySelector(`label[for="${control.id}"]`);
      assert.ok(
        label && label.textContent.trim(),
        `no non-empty <label for="${control.id}"> — a placeholder is not a label`
      );
    }
  } finally {
    unmount();
  }
});

test('the asset select is named, which is the violation axe reported', async () => {
  const { container, unmount } = await render(React.createElement(bundle.InvoiceForm, {}));

  try {
    const select = container.querySelector('select');
    const label = container.querySelector(`label[for="${select.id}"]`);
    assert.equal(label.textContent.trim(), 'Asset');
  } finally {
    unmount();
  }
});

test('every button carries a non-empty accessible name', async () => {
  const invoice = invoiceFixture({ status: 'PAID', customerEmail: undefined });
  const { container, unmount } = await render(
    React.createElement(bundle.PaymentReceipt, { invoice })
  );

  try {
    for (const button of container.querySelectorAll('button')) {
      const name = button.getAttribute('aria-label') ?? button.textContent.trim();
      assert.ok(name, `a button rendered with no accessible name: ${button.outerHTML.slice(0, 120)}`);
    }
  } finally {
    unmount();
  }
});

test('a status badge exposes a text equivalent for its colour', async () => {
  for (const status of ALL_STATUSES) {
    const { container, unmount } = await render(
      React.createElement(bundle.InvoiceCard, { invoice: invoiceFixture({ status }) })
    );

    try {
      const badge = container.querySelector('[aria-label^="Invoice status:"]');
      assert.ok(badge, `${status} badge exposed no text equivalent`);
      assert.equal(badge.getAttribute('aria-label'), statusBadgeLabel(status));
      // The visible text is the readable label, not the raw enum value.
      assert.equal(badge.textContent.trim(), statusText(status).label);
    } finally {
      unmount();
    }
  }
});

test('the unavailable email button stays focusable and says why', async () => {
  const invoice = invoiceFixture({ status: 'PAID', customerEmail: undefined });
  const { container, unmount } = await render(
    React.createElement(bundle.PaymentReceipt, { invoice })
  );

  try {
    const button = container.querySelector('button[aria-disabled="true"]');
    assert.ok(button, 'expected the email button to be marked unavailable');
    // `disabled` would drop it from the tab order, taking the reason with it.
    assert.equal(button.hasAttribute('disabled'), false);

    const reasonId = button.getAttribute('aria-describedby');
    assert.ok(reasonId, 'no aria-describedby pointing at the reason');
    assert.match(
      container.querySelector(`#${reasonId}`).textContent,
      /no client email/i
    );
  } finally {
    unmount();
  }
});

test('the QR code carries a text alternative naming what it encodes', async () => {
  const { container, unmount } = await render(
    React.createElement(bundle.QRCodeDisplay, {
      value: 'https://quittance.test/pay/inv_a11y_fixture',
      description: 'a request to pay 125.50 XLM',
    })
  );

  try {
    const graphic = container.querySelector('[role="img"]');
    assert.ok(graphic, 'the QR code rendered as an unnamed graphic');
    assert.match(graphic.getAttribute('aria-label'), /125\.50 XLM/);
    // The link itself has to be reachable: a QR code is not an equivalent for
    // anyone who cannot point a phone camera at the screen.
    assert.match(container.textContent, /https:\/\/quittance\.test\/pay\//);
  } finally {
    unmount();
  }
});

test('the pay button names the amount it is about to send', async () => {
  const { container, unmount } = await render(
    React.createElement(bundle.PaymentButton, {
      destination: SELLER,
      amount: '125.5',
      memo: 'QT-A11Y-01',
      assetCode: 'XLM',
    })
  );

  try {
    const button = container.querySelector('button');
    assert.equal(button.getAttribute('aria-label'), 'Pay 125.5 XLM with Freighter');
  } finally {
    unmount();
  }
});

test('the wallet menu reports its expanded state', async () => {
  const { container, unmount } = await render(
    React.createElement(bundle.UserProfile, { userWallet: SELLER })
  );

  try {
    const trigger = container.querySelector('button[aria-haspopup="menu"]');
    assert.ok(trigger, 'the wallet menu trigger did not declare a popup');
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  } finally {
    unmount();
  }
});

// ---------------------------------------------------------------------------
// 3. Focus management and live regions on async results
// ---------------------------------------------------------------------------

/** Drives the reducer to the state a given event sequence produces. */
function stateAfter(events) {
  return events.reduce(paymentReducer, initialPaymentState({ status: 'PENDING' }));
}

test('the result panel takes focus when a verification finishes', async () => {
  const dom = getDom();
  const verifying = stateAfter([{ type: 'VERIFY_STARTED' }]);
  const paid = stateAfter([
    { type: 'VERIFY_STARTED' },
    { type: 'VERIFY_SUCCEEDED', invoice: { status: 'PAID' } },
  ]);

  const { container, rerender, unmount } = await render(
    React.createElement(bundle.PaymentResultPanel, { state: verifying })
  );

  try {
    const panel = container.querySelector(`#${PAYMENT_RESULT_ID}`);
    assert.ok(panel, 'the result panel did not render while verifying');
    assert.equal(panel.getAttribute('aria-busy'), 'true');
    // Still in flight: taking focus here would interrupt the payer mid-form.
    assert.notEqual(
      dom.window.document.activeElement,
      panel,
      'focus was taken before the result arrived'
    );

    // The transition is what matters — this is the moment verification lands.
    await rerender(React.createElement(bundle.PaymentResultPanel, { state: paid }));

    const settled = container.querySelector(`#${PAYMENT_RESULT_ID}`);
    assert.equal(
      dom.window.document.activeElement,
      settled,
      'focus did not move to the result panel when the payment was confirmed'
    );
    assert.equal(settled.getAttribute('aria-busy'), 'false');
    assert.match(settled.textContent, /Payment confirmed/i);
  } finally {
    unmount();
  }
});

test('a later poll does not yank focus back out of the settled result', async () => {
  const dom = getDom();
  const paid = stateAfter([{ type: 'POLL_RESULT', invoice: { status: 'PAID' } }]);

  const { container, rerender, unmount } = await render(
    React.createElement(bundle.PaymentResultPanel, {
      state: stateAfter([{ type: 'VERIFY_STARTED' }]),
    })
  );

  try {
    await rerender(React.createElement(bundle.PaymentResultPanel, { state: paid }));
    const panel = container.querySelector(`#${PAYMENT_RESULT_ID}`);
    assert.equal(dom.window.document.activeElement, panel);

    // The payer tabs away to the download button, then a poll lands.
    const elsewhere = dom.window.document.createElement('button');
    dom.window.document.body.appendChild(elsewhere);
    elsewhere.focus();

    await rerender(React.createElement(bundle.PaymentResultPanel, { state: paid }));

    assert.equal(
      dom.window.document.activeElement,
      elsewhere,
      'a repeat render stole focus back from where the payer had moved it'
    );
    elsewhere.remove();
  } finally {
    unmount();
  }
});

test('a failed verification is announced assertively', async () => {
  const failed = stateAfter([
    { type: 'VERIFY_STARTED' },
    { type: 'VERIFY_FAILED', error: 'Memo mismatch' },
  ]);

  const { container, unmount } = await render(
    React.createElement(bundle.PaymentResultPanel, { state: failed })
  );

  try {
    const panel = container.querySelector(`#${PAYMENT_RESULT_ID}`);
    assert.equal(panel.getAttribute('role'), 'alert');
    assert.equal(panel.getAttribute('aria-live'), 'assertive');
    assert.match(panel.textContent, /Memo mismatch/);
  } finally {
    unmount();
  }
});

test('a confirmed payment is announced politely, not assertively', async () => {
  const paid = stateAfter([{ type: 'POLL_RESULT', invoice: { status: 'PAID' } }]);

  const { container, unmount } = await render(
    React.createElement(bundle.PaymentResultPanel, { state: paid })
  );

  try {
    const panel = container.querySelector(`#${PAYMENT_RESULT_ID}`);
    assert.equal(panel.getAttribute('role'), 'status');
    assert.equal(panel.getAttribute('aria-live'), 'polite');
  } finally {
    unmount();
  }
});

test('the result panel is a focus target but not a tab stop', async () => {
  const paid = stateAfter([{ type: 'POLL_RESULT', invoice: { status: 'PAID' } }]);

  const { container, unmount } = await render(
    React.createElement(bundle.PaymentResultPanel, { state: paid })
  );

  try {
    const panel = container.querySelector(`#${PAYMENT_RESULT_ID}`);
    assert.equal(panel.getAttribute('tabindex'), '-1');
  } finally {
    unmount();
  }
});

test('the landing page has no result panel until an invoice is created', async () => {
  primeApi(invoiceFixture());
  bundle.useWalletStore.setState({ publicKey: SELLER, balance: '100.00', connected: true });

  const { container, unmount } = await render(React.createElement(bundle.HomePage));

  try {
    // The panel only exists once an invoice has been created, so before that
    // there is nothing to focus and the landing page keeps the document's.
    assert.equal(container.querySelector('#created-invoice'), null);

    const main = container.querySelector(`#${MAIN_CONTENT_ID}`);
    assert.ok(main, 'the landing page has no main landmark for the skip link');
    assert.equal(main.getAttribute('tabindex'), '-1');
  } finally {
    unmount();
  }
});

test('every core route exposes the main landmark the skip link targets', async () => {
  bundle.useWalletStore.setState({ publicKey: SELLER, balance: '100.00', connected: true });

  const routes = [
    ['landing', bundle.HomePage],
    ['dashboard', bundle.DashboardPage],
    ['pay', bundle.PayPage],
    ['invoice detail', bundle.InvoiceDetailPage],
  ];

  for (const [name, Page] of routes) {
    primeApi(invoiceFixture());
    const { container, unmount } = await render(React.createElement(Page));

    try {
      const main = container.querySelector(`main#${MAIN_CONTENT_ID}`);
      assert.ok(main, `the ${name} route has no <main id="${MAIN_CONTENT_ID}">`);
      assert.equal(
        main.getAttribute('tabindex'),
        '-1',
        `the ${name} route's main landmark cannot receive focus from the skip link`
      );
    } finally {
      unmount();
    }
  }
});

test('the root layout ships the skip link that targets that landmark', () => {
  const layout = fs.readFileSync(path.join(ROOT, 'app', 'layout.tsx'), 'utf8');

  assert.match(layout, /className="skip-link"/, 'no skip link in the root layout');
  assert.match(layout, /MAIN_CONTENT_ID/, 'the skip link does not target the shared main id');
  assert.match(layout, /<html lang="en"/, 'the document language is not declared');
});

test('the dashboard announces its result count in a live region', async () => {
  const invoices = ALL_STATUSES.map((status, index) =>
    invoiceFixture({ id: `inv_${index}`, status })
  );
  primeApi(invoiceFixture(), invoices);
  bundle.useWalletStore.setState({ publicKey: SELLER, balance: '100.00', connected: true });

  const { container, unmount } = await render(React.createElement(bundle.DashboardPage));

  try {
    const region = container.querySelector('#dashboard-results');
    assert.ok(region, 'the dashboard has no results live region');
    assert.equal(region.getAttribute('aria-live'), 'polite');
    assert.match(region.textContent, /invoice/i);
  } finally {
    unmount();
  }
});

test('the pay page renders the async result region', async () => {
  primeApi(invoiceFixture({ status: 'PAID' }));
  bundle.useWalletStore.setState({ publicKey: null, balance: '0.00', connected: false });

  const { container, unmount } = await render(React.createElement(bundle.PayPage));

  try {
    const panel = container.querySelector(`#${PAYMENT_RESULT_ID}`);
    assert.ok(panel, 'the pay page did not render its result panel for a paid invoice');
    assert.equal(panel.getAttribute('aria-live'), 'polite');
    assert.match(panel.textContent, /Payment confirmed/i);
  } finally {
    unmount();
  }
});

// ---------------------------------------------------------------------------
// 4. Contrast, computed from the declared token pairs
// ---------------------------------------------------------------------------

/** WCAG relative luminance of one sRGB channel. */
function channelLuminance(value) {
  const channel = value / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const value = parseInt(hex.slice(1), 16);
  return (
    0.2126 * channelLuminance((value >> 16) & 255) +
    0.7152 * channelLuminance((value >> 8) & 255) +
    0.0722 * channelLuminance(value & 255)
  );
}

/** WCAG 2.1 contrast ratio between two hex colours. */
function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('the contrast ratio helper matches the WCAG reference values', () => {
  // Black on white is the definitional maximum, and a mid grey is a value the
  // specification's own examples pin down.
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff') * 100) / 100, 21);
  assert.equal(Math.round(contrastRatio('#ffffff', '#ffffff') * 100) / 100, 1);
  assert.ok(Math.abs(contrastRatio('#767676', '#ffffff') - 4.54) < 0.02);
});

test('every declared colour pair clears the WCAG level it claims', () => {
  const config = require('../tailwind.config.js');
  const pairs = config.a11yContrastPairs;

  assert.ok(Array.isArray(pairs) && pairs.length > 0, 'no contrast pairs declared');

  const failures = pairs
    .map((pair) => ({ ...pair, ratio: contrastRatio(pair.fg, pair.bg) }))
    .filter((pair) => pair.ratio < (pair.level === 'AA-large' ? 3 : 4.5));

  assert.deepEqual(
    failures.map((pair) => `${pair.name}: ${pair.ratio.toFixed(2)}:1 (${pair.level})`),
    [],
    'colour pairs below the level they claim'
  );
});

test('the shared status text covers every status the backend can return', () => {
  for (const status of ALL_STATUSES) {
    const { label, description } = statusText(status);
    assert.ok(label, `${status} has no label`);
    assert.ok(description.endsWith('.'), `${status} description is not a sentence`);
  }

  // An unshipped status still has to say something rather than read as a
  // coloured rectangle with no text.
  const unknown = statusText('SOMETHING_NEW');
  assert.equal(unknown.label, 'Unknown');
  assert.ok(unknown.description);
});

test('an amount is described as a single value, not two', () => {
  assert.equal(describeAmount('125.50', 'XLM'), '125.50 XLM');
  assert.equal(describeAmount('125.50', ''), '125.50');
});
