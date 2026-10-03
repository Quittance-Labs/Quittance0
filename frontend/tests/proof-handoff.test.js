const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { reportProofHandoff } = require('../lib/proof-handoff.ts');
const { openInvoicePDF } = require('../lib/export.ts');
const { paidInvoice, pendingInvoice } = require('./fixtures/quittance-proof.fixture');
const { installDom, loadBundle, render } = require('./support/a11y-harness');

installDom();
const React = require('react');
const bundle = loadBundle();
const originalWindow = globalThis.window;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalNodeEnv = process.env.NODE_ENV;

test.beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = 'http://127.0.0.1:3001/api';
  process.env.NODE_ENV = 'test';
});

test.afterEach(() => {
  globalThis.window = originalWindow;
  if (originalApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

test('the real HTTP reporter sends only the action and matching correlation headers', async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: JSON.parse(body) });
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { accepted: true } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal(await reportProofHandoff('invoice/with space', { proofFormat: 'text', handoff: 'download', txHash: 'not transmitted' }), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/invoices/invoice%2Fwith%20space/proof-handoff');
    assert.equal(requests[0].method, 'POST');
    assert.deepEqual(requests[0].body, { proofFormat: 'text', handoff: 'download' });
    assert.match(requests[0].headers['x-request-id'], /^req-[0-9a-f]{16}$/);
    assert.equal(requests[0].headers['x-request-id'], requests[0].headers['x-correlation-id']);
    assert.equal(requests[0].headers.cookie, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('unavailable and rejected observation requests settle silently without retry', async (t) => {
  const log = t.mock.method(console, 'error', () => {});
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  assert.equal(await reportProofHandoff(paidInvoice.id, { proofFormat: 'pdf', handoff: 'print-window' }), false);
  assert.equal(fetchMock.mock.callCount(), 1);
  fetchMock.mock.mockImplementation(async () => ({ ok: false, status: 503 }));
  assert.equal(await reportProofHandoff(paidInvoice.id, { proofFormat: 'pdf', handoff: 'print-window' }), false);
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.equal(log.mock.callCount(), 0);
});

test('a stalled observation is aborted within the handoff timeout and never retried', async () => {
  let requests = 0;
  const server = http.createServer(() => { requests += 1; });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.NEXT_PUBLIC_API_URL = `http://127.0.0.1:${server.address().port}/api`;
  const started = Date.now();
  try {
    assert.equal(await reportProofHandoff(paidInvoice.id, { proofFormat: 'text', handoff: 'download' }), false);
    assert.equal(requests, 1);
    assert.ok(Date.now() - started < 3000);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('server rendering and missing production API configuration do not start requests', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  delete globalThis.window;
  assert.equal(await reportProofHandoff(paidInvoice.id, { proofFormat: 'pdf', handoff: 'print-window' }), false);
  globalThis.window = originalWindow;
  process.env.NODE_ENV = 'production';
  delete process.env.NEXT_PUBLIC_API_URL;
  assert.equal(await reportProofHandoff(paidInvoice.id, { proofFormat: 'pdf', handoff: 'print-window' }), false);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('blocked popups and rejected proof generation do not report a handoff', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  t.mock.method(window, 'open', () => null);
  openInvoicePDF(paidInvoice);
  assert.throws(() => openInvoicePDF(pendingInvoice), /only after the invoice is paid/);
  await new Promise(setImmediate);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('failed print-window population does not report a handoff', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  t.mock.method(window, 'open', () => ({ document: { write() { throw new Error('window closed'); } } }));
  assert.throws(() => openInvoicePDF(paidInvoice), /window closed/);
  await new Promise(setImmediate);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('populated print content is unchanged when reporting fails', async (t) => {
  let content;
  let closed = false;
  const popup = { document: { write(value) { content = value; }, close() { closed = true; } } };
  t.mock.method(window, 'open', () => popup);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => { throw new Error('observation failed'); });
  assert.doesNotThrow(() => openInvoicePDF(paidInvoice));
  await new Promise(setImmediate);
  // The print window carries the canonical proof document (#448) even
  // though the observation call failed.
  assert.match(content, /^<!DOCTYPE html>/);
  assert.ok(content.includes(paidInvoice.id));
  assert.ok(content.includes(paidInvoice.paymentTxHash));
  assert.equal(closed, true);
  assert.equal(typeof popup.onload, 'function');
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(JSON.parse(fetchMock.mock.calls[0].arguments[1].body), { proofFormat: 'pdf', handoff: 'print-window' });
});

test('the shipped receipt button dispatches its TXT before reporting, and remains usable offline', async (t) => {
  const order = [];
  t.mock.method(URL, 'createObjectURL', () => 'blob:receipt');
  t.mock.method(URL, 'revokeObjectURL', () => order.push('revoke'));
  t.mock.method(window.HTMLAnchorElement.prototype, 'click', function () {
    assert.equal(this.download, `receipt-${paidInvoice.id}.txt`);
    order.push('download');
  });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    order.push('observe');
    throw new Error('offline');
  });
  const mounted = await render(React.createElement(bundle.PaymentReceipt, { invoice: { ...paidInvoice, amount: 250.5 } }));
  try {
    const button = [...mounted.container.querySelectorAll('button')].find((entry) => entry.textContent.includes('Download TXT receipt'));
    assert.ok(button);
    await React.act(async () => button.click());
    await new Promise(setImmediate);
    assert.deepEqual(order, ['download', 'revoke', 'observe']);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(JSON.parse(fetchMock.mock.calls[0].arguments[1].body), { proofFormat: 'text', handoff: 'download' });
    assert.equal(button.disabled, false);
  } finally {
    await mounted.unmount();
  }
});
