import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import express from 'express';
import { Keypair } from '@stellar/stellar-sdk';
import { WEBHOOK_EVENT_TYPES, webhookProofMessage, type WebhookAction, type WebhookPayload } from '../../shared/webhooks.ts';
import { MemoryStorage } from '../src/storage/memory-storage.ts';
import { MemoryWebhookStorage } from '../src/storage/memory-webhook-storage.ts';
import type { WebhookEndpoint } from '../src/storage/webhook-storage.ts';
import { createWebhookRouter } from '../src/routes/webhook.routes.ts';
import { newWebhookSecret, openWebhookSecret, sealWebhookSecret, verifyWebhookSignature, webhookSignature, webhookSignatureHeader } from '../src/services/webhook-crypto.ts';
import { createWebhookTransport, isPublicWebhookAddress, validateWebhookUrl } from '../src/services/webhook-transport.ts';
import { WebhookWorker } from '../src/services/webhook-worker.ts';

// Public test key, never deployment configuration.
const KEY = Buffer.alloc(32, 0x42);
const seller = Keypair.random();
function endpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return { id: randomUUID(), sellerPublicKey: seller.publicKey(), url: 'https://receiver.example/webhooks',
    events: [...WEBHOOK_EVENT_TYPES], enabled: true, failureCount: 0, createdAt: new Date().toISOString(),
    ...sealWebhookSecret('whsec_public_test', KEY), ...overrides };
}
function invoice(store: MemoryStorage) {
  return store.createInvoice({ id: randomUUID(), memo: 'PRIVATE_MEMO_' + randomUUID(),
    sellerPublicKey: seller.publicKey(), amount: 12.5, assetCode: 'XLM',
    customerName: 'Private Customer', customerEmail: 'customer@private.example',
    sellerEmail: 'seller@private.example', description: 'PRIVATE_DESCRIPTION',
    metadata: { nested: { email: 'nested@private.example' } }, expiresAt: new Date(Date.now() + 86_400_000) });
}

test('documented HMAC vector verifies raw bytes, rejects stale timestamps and tampering', () => {
  const secret = 'whsec_test_0123456789abcdef';
  const body = '{"id":"evt_1","type":"invoice.paid"}';
  const timestamp = 1735689600;
  const expected = '7489caff2d92322967b02be31d80ec2a16eb05ba167bbd9719f630fc84eedd07';
  assert.equal(webhookSignature(secret, timestamp, body), expected);
  const header = 't=' + timestamp + ',v1=' + expected;
  assert.equal(verifyWebhookSignature(secret, header, Buffer.from(body), timestamp * 1000), true);
  assert.equal(verifyWebhookSignature(secret, header, body + ' ', timestamp * 1000), false);
  assert.equal(verifyWebhookSignature(secret, header, body, (timestamp + 301) * 1000), false);
  assert.equal(verifyWebhookSignature(secret, 't=' + timestamp + ',' + header, body, timestamp * 1000), false);
});

test('encrypted rotation signs with both keys only within the promised overlap', async () => {
  const storage = new MemoryWebhookStorage();
  const old = newWebhookSecret(KEY);
  const original = endpoint({ secretHash: old.secretHash, secretEncrypted: old.secretEncrypted });
  await storage.register(original);
  assert.equal(JSON.stringify(await storage.listEndpoints(seller.publicKey())).includes(old.secret), false);
  assert.equal(openWebhookSecret(old.secretEncrypted, old.secretHash, KEY), old.secret);
  const fresh = newWebhookSecret(KEY);
  const now = new Date('2030-01-01T00:00:00Z');
  const rotated = await storage.rotate(seller.publicKey(), original.id, fresh, now, 86_400_000);
  assert.ok(rotated);
  const timestamp = now.getTime() / 1000;
  const header = webhookSignatureHeader(rotated, KEY, timestamp, '{}');
  assert.equal(verifyWebhookSignature(old.secret, header, '{}', now.getTime()), true);
  assert.equal(verifyWebhookSignature(fresh.secret, header, '{}', now.getTime()), true);
  await assert.rejects(storage.rotate(seller.publicKey(), original.id, newWebhookSecret(KEY), now, 86_400_000), /ROTATION_IN_PROGRESS/);
  const later = timestamp + 86_401;
  const laterHeader = webhookSignatureHeader(rotated, KEY, later, '{}');
  assert.equal(verifyWebhookSignature(old.secret, laterHeader, '{}', later * 1000), false);
  assert.equal(verifyWebhookSignature(fresh.secret, laterHeader, '{}', later * 1000), true);
});

test('registration and delivery SSRF checks cover literals, mapped addresses and changed DNS', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '172.16.1.2', '192.168.1.2', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1']) {
    assert.equal(isPublicWebhookAddress(address), false, address);
    await assert.rejects(validateWebhookUrl('https://' + (address.includes(':') ? '[' + address + ']' : address) + '/hook'), /UNSAFE_ADDRESS/);
  }
  await assert.rejects(validateWebhookUrl('https://2130706433/hook'), /UNSAFE_ADDRESS/);
  await assert.rejects(validateWebhookUrl('http://public.example/hook'), /UNSAFE_URL/);
  await assert.rejects(validateWebhookUrl('https://name:password@public.example/hook'), /UNSAFE_URL/);
  assert.equal(isPublicWebhookAddress('93.184.216.34'), true);
  assert.equal(isPublicWebhookAddress('2606:4700:4700::1111'), true);
  const url = 'https://receiver.example/hook';
  await validateWebhookUrl(url, async () => [{ address: '93.184.216.34', family: 4 }]);
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.169.254']) {
    const send = createWebhookTransport({ resolve: async () => [{ address, family: 4 }] });
    await assert.rejects(send(url, '{}', {}), /UNSAFE_ADDRESS/);
  }
  await assert.rejects(validateWebhookUrl(url, async () => [
    { address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 },
  ]), /UNSAFE_ADDRESS/);
});

test('memory lifecycle, audit and payment claims commit with the outbox and redact private fields', async () => {
  class FaultingOutbox extends MemoryWebhookStorage {
    fail = false;
    override prepareEvent(owner: string, payload: WebhookPayload): () => void {
      if (this.fail) throw new Error('forced outbox failure');
      return super.prepareEvent(owner, payload);
    }
  }
  const outbox = new FaultingOutbox();
  await outbox.register(endpoint());
  const store = new MemoryStorage(outbox);
  outbox.fail = true;
  assert.throws(() => invoice(store), /forced outbox failure/);
  assert.equal(store.countInvoices(), 0);
  assert.equal((await outbox.listDeliveries(seller.publicKey())).length, 0);
  outbox.fail = false;
  const paid = invoice(store), cancelled = invoice(store), expired = invoice(store);
  const hash = 'a'.repeat(64), close = new Date();
  outbox.fail = true;
  assert.throws(() => store.markAsPaid(paid.id, hash, seller.publicKey(), undefined, { settledAt: close }), /forced outbox failure/);
  assert.throws(() => store.cancelInvoice(cancelled.id, seller.publicKey()), /forced outbox failure/);
  assert.throws(() => store.markExpiredInvoices(new Date(Date.now() + 172_800_000)), /forced outbox failure/);
  assert.throws(() => store.logPaymentEvent(paid.id, 'PAYMENT_REJECTED', { code: 'AMOUNT_TOO_LOW' }), /forced outbox failure/);
  assert.equal(store.getPaymentClaim(hash), undefined);
  assert.deepEqual(store.getAllInvoices().map(row => row.status), ['PENDING', 'PENDING', 'PENDING']);
  assert.equal(store.getPaymentEvents().length, 0);
  assert.equal((await outbox.listDeliveries(seller.publicKey())).length, 3);
  outbox.fail = false;
  store.markAsPaid(paid.id, hash, seller.publicKey(), { payerEmail: 'payer@private.example' }, { settledAt: close });
  assert.equal(store.markAsPaid(paid.id, hash, seller.publicKey(), undefined, { settledAt: close }), undefined);
  store.cancelInvoice(cancelled.id, seller.publicKey());
  assert.equal(store.cancelInvoice(cancelled.id, seller.publicKey()), undefined);
  assert.equal(store.markExpiredInvoices(new Date(Date.now() + 172_800_000)), 1);
  assert.equal(store.markExpiredInvoices(new Date(Date.now() + 172_800_000)), 0);
  store.logPaymentEvent(paid.id, 'PAYMENT_REJECTED', { code: 'AMOUNT_TOO_LOW', txHash: 'b'.repeat(64),
    memo: 'PRIVATE_MEMO', email: 'private@example.test', error: 'PRIVATE_ERROR', nested: [{ payerEmail: 'private@example.test' }] });
  store.logPaymentEvent(paid.id, 'PARTIAL_PAYMENT', { code: 'AMOUNT_MISMATCH' });
  const deliveries = await outbox.listDeliveries(seller.publicKey());
  assert.deepEqual(deliveries.map(row => row.eventType).sort(), [
    'invoice.created', 'invoice.created', 'invoice.created', 'invoice.paid', 'invoice.cancelled', 'invoice.expired', 'payment.rejected', 'payment.rejected',
  ].sort());
  assert.equal(store.getPaymentEvents().length, 5);
  const text = JSON.stringify(deliveries.map(row => row.payload));
  for (const value of ['PRIVATE_', 'private.example', 'private@example', 'payerPublicKey', 'metadata', 'memo', 'customerName']) assert.equal(text.includes(value), false, value);
  assert.deepEqual(deliveries.find(row => row.payload.payment?.txHash)?.payload.payment, { code: 'AMOUNT_TOO_LOW', txHash: 'b'.repeat(64) });
});

test('actual HTTP receiver 500/500/200 produces three attempts, growing delays and stable event body/id', async t => {
  const received: { body: string; signature: string; eventId: string }[] = [];
  const server = createServer(async (req, res) => {
    const parts: Buffer[] = [];
    for await (const part of req) parts.push(Buffer.from(part));
    received.push({ body: Buffer.concat(parts).toString(), signature: String(req.headers['x-quittance-signature']), eventId: String(req.headers['x-quittance-event-id']) });
    res.writeHead(received.length < 3 ? 500 : 200).end();
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const outbox = new MemoryWebhookStorage(), target = endpoint();
  await outbox.register(target);
  let now = new Date();
  const eventId = randomUUID();
  await outbox.enqueueTest(seller.publicKey(), target.id, eventId, now);
  // Explicit test transport. Production transport has no loopback exemption.
  const worker = new WebhookWorker(outbox, { encryptionKey: KEY, clock: () => now, random: () => 0.5,
    transport: async (_url, body, headers) => {
      const response = await fetch('http://127.0.0.1:' + address.port, { method: 'POST', body, headers });
      await response.arrayBuffer(); return { statusCode: response.status };
    },
  });
  const delays: number[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const started = now.getTime();
    assert.equal(await worker.runOnce(), true);
    const [row] = await outbox.listDeliveries(seller.publicKey());
    assert.equal(row.attempt, attempt);
    assert.equal(verifyWebhookSignature('whsec_public_test', received.at(-1)!.signature, received.at(-1)!.body, now.getTime()), true);
    if (attempt < 3) {
      assert.equal(row.status, 'pending'); assert.equal(await worker.runOnce(), false);
      delays.push(Date.parse(row.nextAttemptAt) - started); now = new Date(row.nextAttemptAt);
    } else { assert.equal(row.status, 'delivered'); assert.equal(row.lastResponseCode, 200); }
  }
  assert.deepEqual(delays, [1125, 2250]);
  assert.equal(new Set(received.map(row => row.body)).size, 1);
  assert.deepEqual(received.map(row => row.eventId), [eventId, eventId, eventId]);
  assert.equal(await worker.runOnce(), false);
});

test('concurrent memory workers exclude an in-flight row and disable after repeated failures', async () => {
  const outbox = new MemoryWebhookStorage(), target = endpoint();
  await outbox.register(target);
  let now = new Date();
  await outbox.enqueueTest(seller.publicKey(), target.id, randomUUID(), now);
  let entered!: () => void, finish!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; });
  const finishedPromise = new Promise<void>(resolve => { finish = resolve; });
  const worker = new WebhookWorker(outbox, { encryptionKey: KEY, clock: () => now, random: () => 0,
    disableAfterFailures: 2, transport: async () => { entered(); await finishedPromise; return { statusCode: 500 }; } });
  const inFlight = worker.runOnce(); await enteredPromise;
  assert.equal(await worker.runOnce(), false);
  finish(); await inFlight;
  now = new Date((await outbox.listDeliveries(seller.publicKey()))[0].nextAttemptAt);
  assert.equal(await worker.runOnce(), true);
  const [delivery] = await outbox.listDeliveries(seller.publicKey());
  assert.equal(delivery.status, 'dead'); assert.equal(delivery.attempt, 2);
  assert.equal((await outbox.listEndpoints(seller.publicKey()))[0].enabled, false);
});

test('mounted seller API binds one-use proofs to operations and returns secrets only on creation/rotation', async t => {
  const outbox = new MemoryWebhookStorage(), now = new Date(), app = express();
  app.use(express.json());
  app.use('/api', createWebhookRouter(outbox, { enabled: true, encryptionKey: KEY, clock: () => now,
    resolve: async () => [{ address: '93.184.216.34', family: 4 }] }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const post = async (path: string, body: any) => {
    const response = await fetch('http://127.0.0.1:' + address.port + '/api' + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as any, cache: response.headers.get('cache-control') };
  };
  const proof = (action: WebhookAction, fields: any = {}, key = seller, age = 0) => {
    const input = { action, sellerPublicKey: key.publicKey(), timestamp: Math.floor(now.getTime() / 1000) - age, nonce: randomUUID(), ...fields };
    const signature = key.sign(Buffer.from(webhookProofMessage(input))).toString('base64');
    const { action: _action, endpointId: _id, ...body } = input;
    return { ...body, signature };
  };
  assert.equal((await post('/webhooks/list', { sellerPublicKey: seller.publicKey() })).status, 401);
  const registration = proof('register', { url: 'https://receiver.example/hook', events: ['invoice.paid'] });
  const registered = await post('/webhooks', registration);
  assert.equal(registered.status, 201); assert.equal(registered.cache, 'no-store');
  const { endpoint: created, secret } = registered.body.data;
  assert.ok(secret.startsWith('whsec_'));
  assert.equal((await post('/webhooks', registration)).status, 409);
  const tampered = proof('register', { url: 'https://receiver.example/hook', events: ['invoice.paid'] });
  tampered.url = 'https://different.example/hook';
  assert.equal((await post('/webhooks', tampered)).status, 401);
  assert.equal((await post('/webhooks/list', proof('list', {}, seller, 300))).status, 401);
  const list = await post('/webhooks/list', proof('list'));
  assert.equal(list.status, 200);
  for (const field of [secret, 'secretHash', 'secretEncrypted']) assert.equal(JSON.stringify(list.body).includes(field), false);
  const other = Keypair.random();
  assert.equal((await post('/webhooks/' + created.id + '/remove', proof('remove', { endpointId: created.id }, other))).status, 404);
  assert.equal((await post('/webhooks/list', proof('list', {}, other))).body.data.endpoints.length, 0);
  for (const url of ['https://127.0.0.1', 'https://10.0.0.1', 'https://169.254.169.254']) {
    assert.equal((await post('/webhooks', proof('register', { url, events: ['invoice.paid'] }))).status, 400);
  }
  assert.equal((await post('/webhooks/' + created.id + '/test', proof('test', { endpointId: created.id }))).status, 202);
  const rotated = await post('/webhooks/' + created.id + '/rotate', proof('rotate', { endpointId: created.id }));
  assert.equal(rotated.status, 200); assert.notEqual(rotated.body.data.secret, secret);
  assert.equal((await post('/webhooks/' + created.id + '/remove', proof('remove', { endpointId: created.id }))).status, 200);
  assert.equal((await outbox.listDeliveries(seller.publicKey()))[0].status, 'cancelled');
});

test('a failed rejection outbox returns 503 without caching; retry records the event before the verdict', async t => {
  const { InvoiceMemoryService } = await import('../src/services/invoice-memory.service.ts');
  const { MemoryInvoiceStorage } = await import('../src/storage/memory-invoice-storage.ts');
  const { createInvoiceRouter } = await import('../src/routes/invoice.routes.ts');
  class FaultingOutbox extends MemoryWebhookStorage {
    fail = false;
    override prepareEvent(owner: string, payload: WebhookPayload): () => void {
      if (this.fail) throw new Error('forced rejection outbox failure');
      return super.prepareEvent(owner, payload);
    }
  }
  const outbox = new FaultingOutbox();
  await outbox.register(endpoint({ events: ['payment.rejected'] }));
  const raw = new MemoryStorage(outbox), created = invoice(raw), hash = 'c'.repeat(64);
  const storage = new MemoryInvoiceStorage(new InvoiceMemoryService(raw));
  let cached = 0;
  const app = express(); app.use(express.json());
  app.use('/api', createInvoiceRouter({ storage, enableRateLimiting: false, enableVerifyCache: false,
    enableCeilingCheck: false, enableConcurrencyLock: false,
    verifyCache: { set: async () => { cached++; } } as any,
    stellar: { getTransaction: async () => ({
      transaction: { hash, successful: true, memo_type: 'text', memo: created.memo, created_at: new Date().toISOString() },
      operations: [{ type: 'payment', from: seller.publicKey(), to: seller.publicKey(),
        asset_type: 'native', amount: '0.1000000', transaction_successful: true }],
    }) },
  }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const verify = async () => {
    const response = await fetch('http://127.0.0.1:' + address.port + '/api/invoices/' + created.id + '/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ txHash: hash }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  outbox.fail = true;
  const failed = await verify();
  assert.equal(failed.status, 503); assert.equal(failed.body.code, 'PAYMENT_EVENT_UNAVAILABLE');
  assert.equal(cached, 0); assert.equal(raw.getPaymentEvents().length, 0);
  outbox.fail = false;
  const retried = await verify();
  assert.equal(retried.status, 400); assert.equal(retried.body.code, 'AMOUNT_TOO_LOW');
  assert.equal(cached, 1); assert.equal(raw.getPaymentEvents().length, 1);
  const [delivery] = await outbox.listDeliveries(seller.publicKey());
  assert.equal(delivery.eventId, raw.getPaymentEvents()[0].id);
  assert.equal(delivery.payload.payment?.code, 'AMOUNT_TOO_LOW');
});
