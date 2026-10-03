/**
 * Issue #431 - the seller invoice detail page's share and proof actions.
 *
 * The workspace itself (who may open it, and the status timeline) is pinned in
 * `invoice-workspace.test.js` and audited in `a11y-core-pages.test.js`. What
 * this file covers is the part the issue actually asks the seller to be able
 * to do: copy the pay link from a phone or a desktop, and reach the invoice
 * and proof emails when there is an address on record.
 *
 * Everything is mounted through the same harness as the accessibility audit —
 * the shipped `app/invoice/[id]/page.tsx`, not a copy — so a copy control that
 * only exists in the source but never renders fails here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');

const { loadBundle, installDom, getDom, render } = require('./support/a11y-harness');

installDom();
const bundle = loadBundle();

// The next/navigation stub resolves every dynamic route to this id.
const INVOICE_ID = 'inv_a11y_fixture';

const SELLER = 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ';
const FOREIGN_WALLET = 'GCKFBEIYTKP7RCZNVPH6PYJHLKGRDJKA76G3XV5F9RBQZBRPKUL7NXCG';
const TX_HASH = 'e'.repeat(64);

function invoiceFixture(overrides = {}) {
  return {
    id: INVOICE_ID,
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
    createdAt: '2026-03-01T10:00:00.000Z',
    expiresAt: '2099-03-08T10:00:00.000Z',
    ...overrides,
  };
}

function connectWallet(publicKey) {
  bundle.useWalletStore.setState({
    publicKey,
    balance: '100.00',
    connected: true,
    network: 'TESTNET',
    networkPassphrase: 'Test SDF Network ; September 2015',
    freighterAvailable: true,
  });
}

function primeApi(invoice) {
  bundle.resetResponses();
  bundle.setResponse(`/invoices/${invoice.id}`, { data: invoice });
  bundle.setResponse(`/invoices/${invoice.id}/payment-info`, {
    data: {
      paymentUrl: `https://quittance.test/pay/${invoice.id}`,
      stellarUri: `web+stellar:pay?destination=${invoice.sellerPublicKey}&amount=125.5000000&memo=${invoice.memo}&memo_type=MEMO_TEXT`,
      copyValue: `https://quittance.test/pay/${invoice.id}`,
      stellarQrEncodesUri: false,
      stellarQrCode: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      paymentAvailable: invoice.status === 'PENDING',
    },
  });
}

/** Captures whatever the clipboard actually receives. */
function stubClipboard() {
  const written = [];
  getDom().window.navigator.clipboard = {
    writeText: async (text) => {
      written.push(text);
    },
  };
  return written;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 25));

test('the seller can copy the pay link, on a desktop or a phone browser', async () => {
  connectWallet(SELLER);
  primeApi(invoiceFixture());

  const written = stubClipboard();
  const { container, unmount } = await render(React.createElement(bundle.InvoiceDetailPage));

  try {
    const button = container.querySelector(
      'button[aria-label="Copy the payment link for this invoice"]'
    );
    assert.ok(button, 'the detail page rendered no copy-pay-link control');

    button.click();
    await settle();

    assert.deepEqual(
      written,
      [`https://quittance.test/pay/${INVOICE_ID}`],
      'the clipboard did not receive this invoice\'s pay link'
    );
  } finally {
    unmount();
  }
});

test('the copy control exists in every status, not only while pending', async () => {
  connectWallet(SELLER);

  for (const status of ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED']) {
    primeApi(
      invoiceFixture({
        status,
        paymentTxHash: status === 'PENDING' ? undefined : TX_HASH,
        paidAt: status === 'PAID' ? '2026-03-02T12:30:00.000Z' : undefined,
      })
    );

    const { container, unmount } = await render(React.createElement(bundle.InvoiceDetailPage));
    try {
      assert.ok(
        container.querySelector('button[aria-label="Copy the payment link for this invoice"]'),
        `no pay-link copy control for a ${status} invoice`
      );
    } finally {
      unmount();
    }
  }
});

test('a paid invoice shows its transaction hash and links the right network explorer', async () => {
  connectWallet(SELLER);
  primeApi(
    invoiceFixture({
      status: 'PAID',
      paymentTxHash: TX_HASH,
      paidAt: '2026-03-02T12:30:00.000Z',
    })
  );

  const { container, unmount } = await render(React.createElement(bundle.InvoiceDetailPage));

  try {
    assert.match(container.textContent, new RegExp(TX_HASH), 'the tx hash is not on the page');

    const links = Array.from(container.querySelectorAll('a[href*="stellar.expert"]'));
    assert.ok(links.length > 0, 'a paid invoice exposed no explorer link');

    // The harness runs the app with NEXT_PUBLIC_STELLAR_NETWORK=TESTNET, which
    // is also the default when nothing is configured. A hardcoded mainnet
    // explorer would sent the seller to a page that cannot show this hash.
    const expected = `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`;
    assert.ok(
      links.some((link) => link.getAttribute('href') === expected),
      `no link to ${expected} — got ${links.map((link) => link.getAttribute('href')).join(', ')}`
    );
    const wrongNetwork = links
      .map((link) => link.getAttribute('href'))
      .filter((href) => href.includes('/explorer/public/tx/'));
    assert.deepEqual(wrongNetwork, [], 'a testnet invoice linked to the mainnet explorer');
  } finally {
    unmount();
  }
});

test("a foreign wallet cannot read another seller's invoice detail", async () => {
  connectWallet(FOREIGN_WALLET);
  primeApi(invoiceFixture());

  const { container, unmount } = await render(React.createElement(bundle.InvoiceDetailPage));

  try {
    assert.match(container.textContent, /Access Restricted/);
    // Nothing about the invoice itself may be on screen: not the amount, the
    // memo, or the client's contact details.
    assert.doesNotMatch(container.textContent, /125\.5/);
    assert.doesNotMatch(container.textContent, /QT-A11Y-01/);
    assert.doesNotMatch(container.textContent, /ada@example\.com/);
    assert.equal(
      container.querySelector('button[aria-label="Copy the payment link for this invoice"]'),
      null,
      'a foreign wallet was offered the seller share actions'
    );
  } finally {
    unmount();
  }
});

test('the invoice and proof emails are offered when a client email exists', async () => {
  connectWallet(SELLER);

  primeApi(invoiceFixture());
  const pending = await render(React.createElement(bundle.InvoiceDetailPage));
  try {
    assert.ok(
      pending.container.querySelector('button[aria-label="Email invoice to ada@example.com"]'),
      'a pending invoice with a client email offered no send-invoice action'
    );
  } finally {
    pending.unmount();
  }

  primeApi(
    invoiceFixture({ status: 'PAID', paymentTxHash: TX_HASH, paidAt: '2026-03-02T12:30:00.000Z' })
  );
  const paid = await render(React.createElement(bundle.InvoiceDetailPage));
  try {
    const proofButton = paid.container.querySelector(
      'button[aria-label="Email payment proof to ada@example.com"]'
    );
    assert.ok(proofButton, 'a paid invoice with a client email offered no send-proof action');
    assert.notEqual(
      proofButton.getAttribute('aria-disabled'),
      'true',
      'the send-proof action was offered but marked unavailable'
    );
  } finally {
    paid.unmount();
  }
});

test('a paid invoice without an address says why the proof cannot be sent', async () => {
  connectWallet(SELLER);
  primeApi(
    invoiceFixture({
      status: 'PAID',
      paymentTxHash: TX_HASH,
      paidAt: '2026-03-02T12:30:00.000Z',
      customerEmail: undefined,
      customerName: undefined,
      payerEmail: undefined,
    })
  );

  const { container, unmount } = await render(React.createElement(bundle.InvoiceDetailPage));

  try {
    const button = container.querySelector('button[aria-label="Email Proof"]');
    assert.ok(button, 'no send-proof control at all');
    assert.equal(button.getAttribute('aria-disabled'), 'true');

    const reasonId = button.getAttribute('aria-describedby');
    assert.ok(reasonId, 'the unavailable control gave no reason');
    assert.match(container.querySelector(`#${reasonId}`).textContent, /no client email/i);
  } finally {
    unmount();
  }
});
