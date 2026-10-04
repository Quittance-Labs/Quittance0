import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it, type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { InvoiceService } from '../src/services/invoice.service';
import { PostgresWebhookStorage } from '../src/storage/postgres-webhook-storage';
import { sealWebhookSecret } from '../src/services/webhook-crypto';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '../../shared/webhooks';
import type { WebhookEndpoint } from '../src/storage/webhook-storage';

const DATABASE_URL = process.env.DATABASE_URL;
const SELLER = 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU';
const PAYER = 'GCT7D6S5VTFGEURS6ZYIO33YZRPQMA3LNWB4GEOHDFDXZGWTA4EPIM5E';
const TX_HASH = 'a'.repeat(64);
const WORKER = path.join(__dirname, 'fixtures/webhook-postgres-worker.ts');

interface WorkerMessage {
  type: string;
  pid: number;
  id?: string;
  eventId?: string;
  attempt?: number;
  processed?: boolean;
  message?: string;
}

/** IPC barriers establish the overlap; no timing guess decides whether workers raced. */
function spawnWorker(t: TestContext, schema: string) {
  const child: ChildProcess = fork(WORKER, [], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, Q584_PG_SCHEMA: schema },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const queued: WorkerMessage[] = [];
  const waiting: Array<{ type: string; resolve: (message: WorkerMessage) => void; reject: (error: Error) => void }> = [];
  let stderr = '';
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let failure: Error | undefined;
  let resolveExit: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => { resolveExit = resolve; });
  child.stderr!.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  child.on('message', (value) => {
    const message = value as WorkerMessage;
    if (message.type === 'error') {
      failure = new Error(message.message || 'Webhook worker failed');
      for (const waiter of waiting.splice(0)) waiter.reject(failure);
      return;
    }
    const index = waiting.findIndex((item) => item.type === message.type);
    if (index === -1) queued.push(message);
    else waiting.splice(index, 1)[0].resolve(message);
  });
  child.on('error', (error) => {
    failure = error;
    for (const waiter of waiting.splice(0)) waiter.reject(error);
    resolveExit({ code: null, signal: null });
  });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
    for (const waiter of waiting.splice(0)) waiter.reject(new Error(`Worker exited before ${waiter.type}: ${code ?? signal}; ${stderr}`));
    resolveExit(exit);
  });
  t.after(async () => {
    if (!exit && child.pid) child.kill('SIGKILL');
    await exited;
  });
  return {
    child, exited,
    send(message: Record<string, unknown>) { child.send(message); },
    wait(type: string): Promise<WorkerMessage> {
      const index = queued.findIndex((item) => item.type === type);
      if (index !== -1) return Promise.resolve(queued.splice(index, 1)[0]);
      if (failure) return Promise.reject(failure);
      if (exit) return Promise.reject(new Error(`Worker already exited before ${type}: ${stderr}`));
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const index = waiting.indexOf(waiter);
          if (index !== -1) waiting.splice(index, 1);
          reject(new Error(`Timed out waiting for worker ${type}: ${stderr}`));
        }, 10_000);
        const waiter = {
          type,
          resolve(message: WorkerMessage) { clearTimeout(timer); resolve(message); },
          reject(error: Error) { clearTimeout(timer); reject(error); },
        };
        waiting.push(waiter);
      });
    },
  };
}

describe('PostgreSQL webhook outbox acceptance', {
  skip: DATABASE_URL ? false : 'DATABASE_URL is not set',
  concurrency: false,
}, () => {
  const schema = `q584_webhooks_${randomUUID().replaceAll('-', '')}`;
  let admin: Pool;
  let database: Pool;
  let invoices: InvoiceService;
  let webhooks: PostgresWebhookStorage;

  before(async () => {
    admin = new Pool({ connectionString: DATABASE_URL });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    database = new Pool({ connectionString: DATABASE_URL, options: `-c search_path=${schema},public` });
    const sql = readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
    await database.query(sql);
    await database.query(sql);
    invoices = new InvoiceService(database);
    webhooks = new PostgresWebhookStorage(database);
  });

  beforeEach(async () => {
    await database.query('DROP TRIGGER IF EXISTS test_reject_outbox ON webhook_deliveries');
    await database.query('TRUNCATE webhook_deliveries, webhook_endpoints, webhook_proofs, payment_events, transactions, invoices CASCADE');
  });

  after(async () => {
    await database?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  async function endpoint(events: readonly WebhookEventType[] = WEBHOOK_EVENT_TYPES) {
    const value: WebhookEndpoint = {
      id: randomUUID(), sellerPublicKey: SELLER, url: 'https://merchant.example/webhook',
      events: [...events], enabled: true, failureCount: 0, createdAt: new Date().toISOString(),
      ...sealWebhookSecret('whsec_integration_test_only', Buffer.alloc(32, 7)),
    };
    await webhooks.register(value);
    return value;
  }
  const createInvoice = (idempotencyKey?: string) => invoices.createInvoice({
    sellerPublicKey: SELLER, amount: 10, assetCode: 'XLM', idempotencyKey,
  });
  async function deliveries(invoiceId: string) {
    const result = await database.query(
      `SELECT * FROM webhook_deliveries WHERE payload->'invoice'->>'id'=$1 ORDER BY created_at,id`, [invoiceId]);
    return result.rows;
  }
  async function failOutboxInserts() {
    await database.query(`CREATE OR REPLACE FUNCTION test_reject_outbox() RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Q584_TEST_OUTBOX_FAILURE'; RETURN NEW; END; $$;
      CREATE TRIGGER test_reject_outbox BEFORE INSERT ON webhook_deliveries
      FOR EACH ROW EXECUTE FUNCTION test_reject_outbox();`);
  }

  it('enqueues each creation and paid/cancelled/expired transition exactly once', async () => {
    await endpoint();
    const paid = await createInvoice('same-create');
    const cancelled = await createInvoice();
    const expired = await createInvoice();
    assert.equal((await createInvoice('same-create')).id, paid.id);
    await invoices.markAsPaid(paid.id, TX_HASH, PAYER, undefined, { settledAt: new Date() });
    await invoices.cancelInvoice(cancelled.id, SELLER);
    await database.query(`UPDATE invoices SET expires_at=now()-interval '1 second' WHERE id=$1`, [expired.id]);
    assert.equal(await invoices.markExpiredInvoices(), 1);
    assert.equal(await invoices.markExpiredInvoices(), 0);
    await assert.rejects(invoices.markAsPaid(paid.id, TX_HASH, PAYER, undefined, { settledAt: new Date() }));
    await assert.rejects(invoices.cancelInvoice(cancelled.id, SELLER));
    await database.query('UPDATE invoices SET status=status');

    for (const [invoice, kind, audit] of [
      [paid, 'invoice.paid', 'PAYMENT_CONFIRMED'],
      [cancelled, 'invoice.cancelled', 'INVOICE_CANCELLED'],
      [expired, 'invoice.expired', 'INVOICE_EXPIRED'],
    ] as const) {
      const rows = await deliveries(invoice.id);
      assert.deepEqual(rows.map((row) => row.event_type).sort(), ['invoice.created', kind].sort());
      assert.equal(new Set(rows.map((row) => row.event_id)).size, 2);
      for (const row of rows) {
        assert.equal(row.payload.id, row.event_id);
        assert.equal(row.payload.invoice.id, invoice.id);
        assert.equal(row.payload.invoice.amount, '10.0000000');
      }
      const events = await invoices.getPaymentEvents(invoice.id);
      assert.equal(events.filter((row) => row.eventType === audit).length, 1);
    }
  });

  it('rolls back invoice creation when its outbox insert fails', async () => {
    await endpoint();
    await failOutboxInserts();
    await assert.rejects(createInvoice('failed-create'), /Q584_TEST_OUTBOX_FAILURE/);
    for (const table of ['invoices', 'payment_events', 'webhook_deliveries']) {
      assert.equal(Number((await database.query(`SELECT count(*) FROM ${table}`)).rows[0].count), 0);
    }
    await database.query('DROP TRIGGER test_reject_outbox ON webhook_deliveries');
    const invoice = await createInvoice('failed-create');
    assert.equal((await deliveries(invoice.id)).length, 1);
  });

  for (const transition of ['paid', 'cancelled', 'expired'] as const) {
    it(`rolls back ${transition} invoice and audit state when its outbox insert fails`, async () => {
      await endpoint();
      const invoice = await createInvoice();
      if (transition === 'expired') {
        await database.query(`UPDATE invoices SET expires_at=now()-interval '1 second' WHERE id=$1`, [invoice.id]);
      }
      const mutate = () => transition === 'paid'
        ? invoices.markAsPaid(invoice.id, TX_HASH, PAYER, undefined, { settledAt: new Date() })
        : transition === 'cancelled'
          ? invoices.cancelInvoice(invoice.id, SELLER)
          : invoices.markExpiredInvoices();
      await failOutboxInserts();
      await assert.rejects(mutate(), /Q584_TEST_OUTBOX_FAILURE/);
      // Direct read intentionally avoids InvoiceService's expiry-on-read sweep.
      const row = (await database.query('SELECT * FROM invoices WHERE id=$1', [invoice.id])).rows[0];
      assert.equal(row.status, 'PENDING');
      assert.equal(row.payment_tx_hash, null);
      assert.equal(row.paid_at, null);
      assert.equal(row.cancelled_at, null);
      assert.equal(row.settled_at, null);
      assert.equal((await invoices.getPaymentEvents(invoice.id)).length, 0);
      assert.deepEqual((await deliveries(invoice.id)).map((row) => row.event_type), ['invoice.created']);

      await database.query('DROP TRIGGER test_reject_outbox ON webhook_deliveries');
      await mutate();
      assert.equal((await deliveries(invoice.id)).filter((row) => row.event_type === `invoice.${transition}`).length, 1);
      assert.equal((await invoices.getPaymentEvents(invoice.id)).length, 1);
    });
  }

  it('commits a payment rejection audit and outbox together, with the same event id', async () => {
    await endpoint();
    const invoice = await createInvoice();
    const rejection = { code: 'ASSET_MISMATCH', txHash: TX_HASH, customerEmail: 'private@example.invalid', memo: 'private-memo' };
    await failOutboxInserts();
    await assert.rejects(invoices.logPaymentEvent(invoice.id, 'PAYMENT_REJECTED', rejection), /Q584_TEST_OUTBOX_FAILURE/);
    assert.equal((await invoices.getPaymentEvents(invoice.id)).length, 0);
    assert.equal((await deliveries(invoice.id)).filter((row) => row.event_type === 'payment.rejected').length, 0);
    await database.query('DROP TRIGGER test_reject_outbox ON webhook_deliveries');
    await invoices.logPaymentEvent(invoice.id, 'PAYMENT_REJECTED', rejection);
    const audit = (await invoices.getPaymentEvents(invoice.id))[0];
    const outbox = (await deliveries(invoice.id)).filter((row) => row.event_type === 'payment.rejected');
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0].event_id, audit.id);
    assert.deepEqual(outbox[0].payload.payment, { code: rejection.code, txHash: TX_HASH });
    assert.doesNotMatch(JSON.stringify(outbox[0].payload), /private@example|private-memo/);
    assert.equal((await invoices.getInvoiceById(invoice.id))?.status, 'PENDING');
  });

  it('lets only one of two separate worker processes own a due delivery', { timeout: 30_000 }, async (t) => {
    await endpoint(['invoice.created']);
    const invoice = await createInvoice();
    const [row] = await deliveries(invoice.id);
    const first = spawnWorker(t, schema);
    await first.wait('ready');
    first.send({ type: 'run', mode: 'hold', now: new Date().toISOString() });
    const claim = await first.wait('claimed');
    assert.equal(claim.id, row.id);

    const second = spawnWorker(t, schema);
    await second.wait('ready');
    assert.notEqual(first.child.pid, second.child.pid);
    second.send({ type: 'run', mode: 'finish', now: new Date().toISOString() });
    const refused = await second.wait('done');
    assert.equal(refused.processed, false, 'second worker must finish without claiming the held row');
    assert.equal((await second.exited).code, 0);
    assert.equal((await deliveries(invoice.id))[0].attempt, 0, 'first worker has not committed its delivery');

    first.send({ type: 'release' });
    assert.equal((await first.wait('done')).processed, true);
    assert.equal((await first.exited).code, 0);
    const [delivered] = await deliveries(invoice.id);
    assert.equal(delivered.id, row.id);
    assert.equal(delivered.event_id, row.event_id);
    assert.equal(delivered.status, 'delivered');
    assert.equal(delivered.attempt, 1);
  });

  it('retains the pending event after a worker crash and delivers it on restart', { timeout: 30_000 }, async (t) => {
    await endpoint(['invoice.created']);
    const invoice = await createInvoice();
    const [row] = await deliveries(invoice.id);
    const first = spawnWorker(t, schema);
    await first.wait('ready');
    first.send({ type: 'run', mode: 'hold', now: new Date().toISOString() });
    assert.equal((await first.wait('claimed')).id, row.id);
    first.child.kill('SIGKILL');
    assert.equal((await first.exited).signal, 'SIGKILL');
    // Wait for PostgreSQL to observe that exact terminated client's disconnect.
    // This is cleanup synchronization, not a claimed latency benchmark.
    const deadline = Date.now() + 5000;
    for (;;) {
      const active = await admin.query('SELECT count(*) FROM pg_stat_activity WHERE application_name=$1', [`q584-worker-${first.child.pid}`]);
      if (Number(active.rows[0].count) === 0) break;
      assert.ok(Date.now() < deadline, 'database must release the crashed worker connection');
      await delay(20);
    }
    const [pending] = await deliveries(invoice.id);
    assert.equal(pending.id, row.id);
    assert.equal(pending.event_id, row.event_id);
    assert.equal(pending.status, 'pending');
    assert.equal(pending.attempt, 0);

    const restarted = spawnWorker(t, schema);
    await restarted.wait('ready');
    restarted.send({ type: 'run', mode: 'finish', now: new Date().toISOString() });
    const claim = await restarted.wait('claimed');
    assert.equal(claim.eventId, row.event_id);
    assert.equal(claim.attempt, 0);
    assert.equal((await restarted.wait('done')).processed, true);
    assert.equal((await restarted.exited).code, 0);
    const [delivered] = await deliveries(invoice.id);
    assert.equal(delivered.status, 'delivered');
    assert.equal(delivered.attempt, 1);
    assert.equal((await deliveries(invoice.id)).length, 1);
  });
});
