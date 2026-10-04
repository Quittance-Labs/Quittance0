import { Pool } from 'pg';
import { PostgresWebhookStorage } from '../../src/storage/postgres-webhook-storage';

// One real database transaction per child. The parent controls only when a
// claimed delivery may finish; no webhook request or payload crosses IPC.
let pool: Pool | undefined;
let closing: Promise<void> | undefined;
let running = false;
let finished = false;
let releaseHold: (() => void) | undefined;

function send(message: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send || !process.connected) {
      reject(Object.assign(new Error('Worker requires IPC'), { code: 'IPC_UNAVAILABLE' }));
      return;
    }
    process.send(message, error => error ? reject(error) : resolve());
  });
}

function closePool(): Promise<void> {
  return closing ??= pool ? pool.end() : Promise.resolve();
}

async function fail(error: unknown): Promise<void> {
  if (finished) return;
  finished = true;
  process.exitCode = 1;
  const code = (error as { code?: unknown } | null)?.code;
  // Database messages can contain connection details or row values. Report
  // only a stable explanation and the diagnostic code, never the raw error.
  await send({
    type: 'error',
    message: 'PostgreSQL webhook worker failed',
    ...(typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? { code } : {}),
  }).catch(() => {});
  await closePool().catch(() => {});
  if (process.connected) process.disconnect();
}

async function main(): Promise<void> {
  const schema = process.env.Q584_PG_SCHEMA;
  const connectionString = process.env.DATABASE_URL;
  if (!schema || !/^q584_webhooks_[a-f0-9]+$/.test(schema) || !connectionString) {
    throw Object.assign(new Error('Invalid worker configuration'), { code: 'INVALID_WORKER_CONFIG' });
  }
  pool = new Pool({
    connectionString,
    max: 1,
    options: `-c search_path=${schema}`,
    application_name: `q584-worker-${process.pid}`,
  });
  pool.on('error', error => { void fail(error); });
  const storage = new PostgresWebhookStorage(pool);

  async function run(command: Record<string, unknown>): Promise<void> {
    const mode = command.mode;
    const rawNow = command.now;
    if (typeof rawNow !== 'string' || (mode !== 'hold' && mode !== 'finish')) {
      throw Object.assign(new Error('Invalid run command'), { code: 'INVALID_WORKER_COMMAND' });
    }
    const now = new Date(rawNow);
    if (!Number.isFinite(now.getTime())) {
      throw Object.assign(new Error('Invalid run time'), { code: 'INVALID_WORKER_COMMAND' });
    }
    const timestamp = now.toISOString();
    const processed = await storage.processNext(now, async (delivery, _endpoint) => {
      // Register release before announcing the claim: the parent may reply
      // immediately, before the send callback has completed in this child.
      const held = mode === 'hold'
        ? new Promise<void>(resolve => { releaseHold = resolve; })
        : undefined;
      await send({
        type: 'claimed', pid: process.pid, id: delivery.id,
        eventId: delivery.eventId, attempt: delivery.attempt,
      });
      if (held) await held;
      releaseHold = undefined;
      return {
        attempt: delivery.attempt + 1,
        status: 'delivered',
        nextAttemptAt: timestamp,
        lastResponseCode: 200,
        completedAt: timestamp,
        failureCount: 0,
        disableEndpoint: false,
      };
    });
    // processNext returns only after COMMIT. Close the connection before the
    // receipt so a parent can inspect durable state without a lingering pool.
    await closePool();
    await send({ type: 'done', pid: process.pid, processed });
    finished = true;
    if (process.connected) process.disconnect();
  }

  process.on('message', message => {
    if (finished || !message || typeof message !== 'object') return;
    const command = message as Record<string, unknown>;
    if (command.type === 'release') {
      releaseHold?.();
      return;
    }
    if (command.type !== 'run' || running) return;
    running = true;
    void run(command).catch(fail);
  });
  await send({ type: 'ready', pid: process.pid });
}

void main().catch(fail);
