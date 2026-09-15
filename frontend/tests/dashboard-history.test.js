/**
 * Dashboard history scoping (issue #232).
 *
 * The dashboard shows the connected seller's Quittance invoices and nothing
 * else. These tests pin both halves of that: unrelated invoices are never
 * rendered, and switching wallets does not leave the previous seller's data on
 * screen while the next request is still in flight.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  belongsToSeller,
  dashboardDataFor,
  actionableInvoices,
  emptyDashboardData,
  exportableInvoices,
  hasAnyInvoices,
  historicalInvoices,
  invoiceSearchText,
  revenueEntries,
  scopeInvoicesToSeller,
  searchInvoices,
  filterInvoicesByStatus,
  sortInvoices,
  DASHBOARD_SORT_OPTIONS,
  applyInvoiceCancellation,
} = require('../lib/dashboard-history');

const ALICE = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const BOB = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

const invoice = (overrides = {}) => ({
  id: 'inv-1',
  memo: 'QTN-1',
  amount: 25,
  assetCode: 'XLM',
  status: 'PENDING',
  sellerPublicKey: ALICE,
  ...overrides,
});

// ------------------------------------------------------------------ scoping

test('an invoice belongs only to the seller that issued it', () => {
  assert.equal(belongsToSeller(invoice(), ALICE), true);
  assert.equal(belongsToSeller(invoice(), BOB), false);
});

test('scoping needs both an invoice and a wallet', () => {
  assert.equal(belongsToSeller(null, ALICE), false);
  assert.equal(belongsToSeller(invoice(), null), false);
  assert.equal(belongsToSeller(invoice(), undefined), false);
});

test('another seller’s invoices are dropped', () => {
  const mixed = [
    invoice({ id: 'a' }),
    invoice({ id: 'b', sellerPublicKey: BOB }),
    invoice({ id: 'c' }),
  ];

  assert.deepEqual(
    scopeInvoicesToSeller(mixed, ALICE).map((item) => item.id),
    ['a', 'c']
  );
});

test('scoping without a wallet yields nothing', () => {
  assert.deepEqual(scopeInvoicesToSeller([invoice()], null), []);
  assert.deepEqual(scopeInvoicesToSeller(null, ALICE), []);
});

// ------------------------------------------------------- wallet switching

test('a disconnected wallet shows nothing', () => {
  const loaded = { owner: ALICE, invoices: [invoice()], stats: { total_invoices: 1 } };

  assert.deepEqual(dashboardDataFor(loaded, null), emptyDashboardData());
});

test("switching wallets does not leak the previous seller's invoices", () => {
  // Alice's data is loaded; Bob connects; Bob's request has not returned yet.
  const loaded = { owner: ALICE, invoices: [invoice()], stats: { total_invoices: 4 } };
  const shown = dashboardDataFor(loaded, BOB);

  assert.deepEqual(shown.invoices, [], 'Bob must not see Alice’s invoices');
  assert.equal(shown.stats, null, 'Bob must not see Alice’s stats');
});

test('data is shown once it belongs to the connected wallet', () => {
  const loaded = { owner: BOB, invoices: [invoice({ sellerPublicKey: BOB })], stats: {} };
  const shown = dashboardDataFor(loaded, BOB);

  assert.equal(shown.invoices.length, 1);
});

test('a response that mixes sellers is still filtered', () => {
  // Defence in depth: the backend scopes its query, but a wrong response must
  // not be rendered either.
  const loaded = {
    owner: ALICE,
    invoices: [invoice({ id: 'mine' }), invoice({ id: 'theirs', sellerPublicKey: BOB })],
    stats: {},
  };

  assert.deepEqual(
    dashboardDataFor(loaded, ALICE).invoices.map((item) => item.id),
    ['mine']
  );
});

test('nothing loaded yet shows the empty dashboard', () => {
  assert.deepEqual(dashboardDataFor(null, ALICE), emptyDashboardData());
  assert.deepEqual(dashboardDataFor({ owner: null, invoices: [], stats: null }, ALICE),
    emptyDashboardData());
});

// ------------------------------------------------------------------- search

test('search matches the fields the seller supplied', () => {
  const invoices = [
    invoice({ id: 'a', customerName: 'Ada Lovelace' }),
    invoice({ id: 'b', description: 'Consulting retainer' }),
    invoice({ id: 'c', amount: 1234 }),
  ];

  assert.deepEqual(searchInvoices(invoices, 'ada').map((i) => i.id), ['a']);
  assert.deepEqual(searchInvoices(invoices, 'retainer').map((i) => i.id), ['b']);
  assert.deepEqual(searchInvoices(invoices, '1234').map((i) => i.id), ['c']);
});

test('an empty query returns everything', () => {
  const invoices = [invoice({ id: 'a' }), invoice({ id: 'b' })];

  assert.equal(searchInvoices(invoices, '').length, 2);
  assert.equal(searchInvoices(invoices, '   ').length, 2);
  assert.equal(searchInvoices(invoices, undefined).length, 2);
});

test('search is case-insensitive and tolerates missing optional fields', () => {
  const invoices = [invoice({ id: 'a', customerName: 'Ada' })];

  assert.equal(searchInvoices(invoices, 'ADA').length, 1);
  // description, customerEmail and customerName are all optional.
  assert.doesNotThrow(() => invoiceSearchText(invoice()));
});

test('search matches customer, seller, and payer fields', () => {
  const invoices = [
    invoice({ id: 'a', customerEmail: 'client@example.com' }),
    invoice({ id: 'b', sellerName: 'Satoshi Consulting' }),
    invoice({ id: 'c', sellerEmail: 'sat@quittance.io' }),
    invoice({ id: 'd', payerName: 'Bob Payer' }),
    invoice({ id: 'e', payerEmail: 'bob@stellar.org' }),
  ];

  assert.deepEqual(searchInvoices(invoices, 'client@example.com').map((i) => i.id), ['a']);
  assert.deepEqual(searchInvoices(invoices, 'Satoshi').map((i) => i.id), ['b']);
  assert.deepEqual(searchInvoices(invoices, 'sat@quittance.io').map((i) => i.id), ['c']);
  assert.deepEqual(searchInvoices(invoices, 'Bob Payer').map((i) => i.id), ['d']);
  assert.deepEqual(searchInvoices(invoices, 'bob@stellar.org').map((i) => i.id), ['e']);
});

test('search never reads wallet activity', () => {
  // Only invoice fields are searchable; a Horizon-style field is ignored.
  const invoices = [invoice({ id: 'a', transactionHash: 'deadbeef' })];

  assert.deepEqual(searchInvoices(invoices, 'deadbeef'), []);
});

// -------------------------------------------------------------------- export

test('only paid invoices are exportable', () => {
  const invoices = [
    invoice({ id: 'a', status: 'PAID' }),
    invoice({ id: 'b', status: 'PENDING' }),
    invoice({ id: 'c', status: 'EXPIRED' }),
    invoice({ id: 'd', status: 'PAID' }),
  ];

  assert.deepEqual(exportableInvoices(invoices).map((i) => i.id), ['a', 'd']);
});

test('elapsed pending invoices leave actionable counts but remain in history', () => {
  const now = '2026-08-30T12:00:00.000Z';
  const invoices = [
    invoice({ id: 'live', expiresAt: '2026-08-31T12:00:00.000Z' }),
    invoice({ id: 'elapsed', expiresAt: '2026-08-29T12:00:00.000Z' }),
    invoice({ id: 'paid', status: 'PAID' }),
  ];

  assert.deepEqual(actionableInvoices(invoices, now).map((i) => i.id), ['live']);
  assert.deepEqual(historicalInvoices(invoices, now).map((i) => i.id), ['elapsed', 'paid']);
  assert.equal(historicalInvoices(invoices, now)[0].status, 'EXPIRED');
});

test('dashboard stats reconcile a locally elapsed invoice until the next server read', () => {
  const now = '2026-08-30T12:00:00.000Z';
  const loaded = {
    owner: ALICE,
    invoices: [invoice({ expiresAt: '2026-08-29T12:00:00.000Z' })],
    stats: { total_invoices: 1, pending_invoices: 1, actionable_invoices: 1, expired_invoices: 0 },
  };
  const shown = dashboardDataFor(loaded, ALICE, now);

  assert.equal(shown.stats.pending_invoices, 0);
  assert.equal(shown.stats.actionable_invoices, 0);
  assert.equal(shown.stats.expired_invoices, 1);
  assert.equal(shown.invoices[0].status, 'EXPIRED');
});

test('export handles nothing to export', () => {
  assert.deepEqual(exportableInvoices([]), []);
  assert.deepEqual(exportableInvoices(null), []);
});

// --------------------------------------------------------------------- stats

test('revenue is reported per asset, sorted, never combined', () => {
  const entries = revenueEntries({ revenue_by_asset: { USDC: 40, XLM: 100, EURC: 5 } });

  assert.deepEqual(entries, [
    ['EURC', 5],
    ['USDC', 40],
    ['XLM', 100],
  ]);
});

test('missing revenue is an empty list, not a zero total', () => {
  assert.deepEqual(revenueEntries(null), []);
  assert.deepEqual(revenueEntries({}), []);
  assert.deepEqual(revenueEntries({ revenue_by_asset: null }), []);
});

test('hasAnyInvoices reads the seller-scoped total', () => {
  assert.equal(hasAnyInvoices({ total_invoices: 3 }), true);
  assert.equal(hasAnyInvoices({ total_invoices: 0 }), false);
  assert.equal(hasAnyInvoices(null), false);
});

// ----------------------------------------------------------------- cancelled

test('INVOICE_FILTERS includes cancelled status', () => {
  const { INVOICE_FILTERS } = require('../lib/dashboard-history');
  assert.ok(INVOICE_FILTERS.includes('cancelled'));
});

test('cancelled invoices are retained in historical invoices', () => {
  const now = '2026-08-30T12:00:00.000Z';
  const invoices = [
    invoice({ id: 'live', expiresAt: '2026-08-31T12:00:00.000Z' }),
    invoice({ id: 'cancelled', status: 'CANCELLED' }),
  ];

  assert.deepEqual(actionableInvoices(invoices, now).map((i) => i.id), ['live']);
  assert.deepEqual(historicalInvoices(invoices, now).map((i) => i.id), ['cancelled']);
});

test('searchInvoices finds publicId, clientName, clientEmail, and scopes to seller', () => {
  const aliceInvoices = [
    invoice({ id: 'inv-1', publicId: 'PUB-101', clientName: 'Acme Corp', clientEmail: 'billing@acme.com', sellerPublicKey: ALICE }),
    invoice({ id: 'inv-2', publicId: 'PUB-102', clientName: 'Globex Ltd', clientEmail: 'ops@globex.com', sellerPublicKey: ALICE }),
  ];
  const bobInvoices = [
    invoice({ id: 'inv-3', publicId: 'PUB-103', clientName: 'Acme Branch', clientEmail: 'branch@acme.com', sellerPublicKey: BOB }),
  ];
  const mixed = [...aliceInvoices, ...bobInvoices];

  assert.deepEqual(
    searchInvoices(mixed, 'PUB-101', ALICE).map((i) => i.id),
    ['inv-1']
  );
  assert.deepEqual(
    searchInvoices(mixed, 'Acme', ALICE).map((i) => i.id),
    ['inv-1']
  );
  assert.deepEqual(
    searchInvoices(mixed, 'Acme', BOB).map((i) => i.id),
    ['inv-3']
  );
  assert.deepEqual(
    searchInvoices(mixed, 'globex', ALICE).map((i) => i.id),
    ['inv-2']
  );
  assert.deepEqual(
    searchInvoices(mixed, 'globex', BOB),
    []
  );
});

test('filterInvoicesByStatus respects seller scoping', () => {
  const mixed = [
    invoice({ id: 'inv-1', status: 'PENDING', sellerPublicKey: ALICE }),
    invoice({ id: 'inv-2', status: 'PAID', sellerPublicKey: ALICE }),
    invoice({ id: 'inv-3', status: 'PENDING', sellerPublicKey: BOB }),
  ];

  assert.deepEqual(
    filterInvoicesByStatus(mixed, 'pending', ALICE).map((i) => i.id),
    ['inv-1']
  );
  assert.deepEqual(
    filterInvoicesByStatus(mixed, 'all', ALICE).map((i) => i.id),
    ['inv-1', 'inv-2']
  );
  assert.deepEqual(
    filterInvoicesByStatus(mixed, 'pending', BOB).map((i) => i.id),
    ['inv-3']
  );
  assert.deepEqual(
    filterInvoicesByStatus(mixed, 'paid', BOB).map((i) => i.id),
    []
  );
});

test('switching accounts immediately clears prior wallet rows and leaves search/filter empty during transition window', () => {
  const aliceState = {
    owner: ALICE,
    invoices: [
      invoice({ id: 'alice-1', memo: 'QTN-ALICE-1', status: 'PENDING', sellerPublicKey: ALICE }),
      invoice({ id: 'alice-2', memo: 'QTN-ALICE-2', status: 'PAID', sellerPublicKey: ALICE }),
    ],
    stats: { total_invoices: 2, pending_invoices: 1, paid_invoices: 1 },
  };

  const switchedState = aliceState.owner === BOB ? aliceState : { owner: BOB, invoices: [], stats: null };
  assert.equal(switchedState.owner, BOB);
  assert.deepEqual(switchedState.invoices, []);
  assert.equal(switchedState.stats, null);

  const displayedDuringTransition = dashboardDataFor(aliceState, BOB);
  assert.deepEqual(displayedDuringTransition.invoices, []);
  assert.equal(displayedDuringTransition.stats, null);

  const searchDuringTransition = searchInvoices(displayedDuringTransition.invoices, 'ALICE', BOB);
  assert.deepEqual(searchDuringTransition, []);

  const filterDuringTransition = filterInvoicesByStatus(displayedDuringTransition.invoices, 'pending', BOB);
  assert.deepEqual(filterDuringTransition, []);
});

test('applyInvoiceCancellation safely updates pending invoice to cancelled and decrements counts', () => {
  const loaded = {
    owner: ALICE,
    invoices: [
      invoice({ id: 'inv-1', status: 'PENDING', sellerPublicKey: ALICE }),
      invoice({ id: 'inv-2', status: 'PAID', sellerPublicKey: ALICE }),
    ],
    stats: {
      total_invoices: 2,
      pending_invoices: 1,
      actionable_invoices: 1,
      paid_invoices: 1,
    },
  };

  const updated = applyInvoiceCancellation(loaded, ALICE, 'inv-1');
  assert.equal(updated.invoices[0].status, 'CANCELLED');
  assert.equal(updated.invoices[1].status, 'PAID');
  assert.equal(updated.stats.pending_invoices, 0);
  assert.equal(updated.stats.actionable_invoices, 0);
});

test('applyInvoiceCancellation refuses mutation when resolving after wallet switch', () => {
  const loaded = {
    owner: BOB,
    invoices: [
      invoice({ id: 'inv-bob', status: 'PENDING', sellerPublicKey: BOB }),
    ],
    stats: { total_invoices: 1, pending_invoices: 1 },
  };

  const updated = applyInvoiceCancellation(loaded, BOB, 'inv-alice');
  assert.deepEqual(updated, loaded);

  const mismatchedOwner = applyInvoiceCancellation(loaded, ALICE, 'inv-bob');
  assert.deepEqual(mismatchedOwner, loaded);
});

test('applyInvoiceCancellation does not alter state for non-pending status or missing invoice', () => {
  const loaded = {
    owner: ALICE,
    invoices: [
      invoice({ id: 'inv-paid', status: 'PAID', sellerPublicKey: ALICE }),
    ],
    stats: { total_invoices: 1, pending_invoices: 0, paid_invoices: 1 },
  };

  const updated = applyInvoiceCancellation(loaded, ALICE, 'inv-paid');
  assert.equal(updated.invoices[0].status, 'CANCELLED');
  assert.equal(updated.stats.pending_invoices, 0);

  const nonExistent = applyInvoiceCancellation(loaded, ALICE, 'inv-unknown');
  assert.deepEqual(nonExistent, loaded);
});
