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

// ----------------------------------------------------------- filter & sort

test('filterInvoicesByStatus handles all known statuses and case insensitivity', () => {
  const invoices = [
    invoice({ id: '1', status: 'PENDING' }),
    invoice({ id: '2', status: 'PAID' }),
    invoice({ id: '3', status: 'EXPIRED' }),
    invoice({ id: '4', status: 'CANCELLED' }),
  ];

  assert.equal(filterInvoicesByStatus(invoices, 'all').length, 4);
  assert.deepEqual(filterInvoicesByStatus(invoices, 'pending').map((i) => i.id), ['1']);
  assert.deepEqual(filterInvoicesByStatus(invoices, 'PAID').map((i) => i.id), ['2']);
  assert.deepEqual(filterInvoicesByStatus(invoices, 'expired').map((i) => i.id), ['3']);
  assert.deepEqual(filterInvoicesByStatus(invoices, 'Cancelled').map((i) => i.id), ['4']);
  assert.deepEqual(filterInvoicesByStatus(null, 'all'), []);
});

test('sortInvoices sorts by newest, oldest, amount, and status with stable tiebreaking', () => {
  const invoices = [
    invoice({ id: 'a', amount: 10, createdAt: '2026-08-01T10:00:00.000Z', status: 'PENDING' }),
    invoice({ id: 'b', amount: 50, createdAt: '2026-08-03T10:00:00.000Z', status: 'PAID' }),
    invoice({ id: 'c', amount: 20, createdAt: '2026-08-02T10:00:00.000Z', status: 'CANCELLED' }),
  ];

  assert.deepEqual(sortInvoices(invoices, 'newest').map((i) => i.id), ['b', 'c', 'a']);
  assert.deepEqual(sortInvoices(invoices, 'oldest').map((i) => i.id), ['a', 'c', 'b']);
  assert.deepEqual(sortInvoices(invoices, 'amount-desc').map((i) => i.id), ['b', 'c', 'a']);
  assert.deepEqual(sortInvoices(invoices, 'amount-asc').map((i) => i.id), ['a', 'c', 'b']);
  assert.deepEqual(sortInvoices(invoices, 'status').map((i) => i.id), ['c', 'b', 'a']);
  assert.deepEqual(sortInvoices([], 'newest'), []);
  assert.deepEqual(sortInvoices(null, 'newest'), []);
});

test('DASHBOARD_SORT_OPTIONS defines the supported sort modes', () => {
  assert.ok(DASHBOARD_SORT_OPTIONS.includes('newest'));
  assert.ok(DASHBOARD_SORT_OPTIONS.includes('oldest'));
  assert.ok(DASHBOARD_SORT_OPTIONS.includes('amount-desc'));
  assert.ok(DASHBOARD_SORT_OPTIONS.includes('amount-asc'));
  assert.ok(DASHBOARD_SORT_OPTIONS.includes('status'));
});

