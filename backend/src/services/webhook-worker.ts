import { emitOperationalFailure } from '../observability/log-events';
import type { WebhookStorage, WebhookAttemptResult } from '../storage/webhook-storage';
import { monitorBackoffMs } from '../utils/monitor-retry-backoff';
import { redactWebhookPayload } from '../utils/payment-event-redaction';
import { webhookEncryptionKey, webhookSignatureHeader } from './webhook-crypto';
import {
  createWebhookTransport,
  WebhookTransportError,
  type WebhookTransport,
} from './webhook-transport';

export interface WebhookWorkerOptions {
  encryptionKey: Buffer;
  transport?: WebhookTransport;
  maxAttempts?: number;
  disableAfterFailures?: number;
  clock?: () => Date;
  random?: () => number;
  pollMs?: number;
}

function boundedInteger(value: number, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(name + ' must be an integer from ' + min + ' through ' + max);
  }
  return value;
}

export class WebhookWorker {
  private readonly transport: WebhookTransport;
  private readonly maxAttempts: number;
  private readonly disableAfterFailures: number;
  private readonly clock: () => Date;
  private readonly random: () => number;
  private readonly pollMs: number;
  private timer?: ReturnType<typeof setInterval>;
  private inFlight?: Promise<void>;
  private running = false;

  constructor(
    private readonly storage: WebhookStorage,
    private readonly options: WebhookWorkerOptions
  ) {
    if (!Buffer.isBuffer(options.encryptionKey) || options.encryptionKey.length !== 32) {
      throw new Error('Webhook encryption requires a 32-byte key');
    }
    this.transport = options.transport ?? createWebhookTransport();
    this.maxAttempts = boundedInteger(options.maxAttempts ?? 8, 'maxAttempts', 1, 20);
    this.disableAfterFailures = boundedInteger(
      options.disableAfterFailures ?? 10, 'disableAfterFailures', 1, 100
    );
    this.clock = options.clock ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.pollMs = boundedInteger(options.pollMs ?? 1000, 'pollMs', 1, 60_000);
  }

  /** The adapter holds the delivery and endpoint locks until this attempt commits. */
  async runOnce(now: Date = this.clock()): Promise<boolean> {
    return this.storage.processNext(now, async (delivery, endpoint): Promise<WebhookAttemptResult> => {
      const attempt = delivery.attempt + 1;
      let lastResponseCode: number | undefined;
      let lastErrorCode: string | undefined;
      try {
        const body = JSON.stringify(redactWebhookPayload(delivery.payload));
        const timestamp = Math.floor(this.clock().getTime() / 1000);
        const signature = webhookSignatureHeader(
          endpoint, this.options.encryptionKey, timestamp, body
        );
        const response = await this.transport(endpoint.url, body, {
          'X-Quittance-Signature': signature,
          'X-Quittance-Event-Id': delivery.eventId,
          'X-Quittance-Event-Type': delivery.eventType,
          'User-Agent': 'Quittance-Webhooks/1',
        });
        if (Number.isInteger(response.statusCode)) {
          lastResponseCode = response.statusCode;
        }
        if (
          !Number.isInteger(response.statusCode) ||
          response.statusCode < 200 ||
          response.statusCode >= 300
        ) {
          lastErrorCode = 'HTTP_ERROR';
        }
      } catch (error) {
        lastErrorCode = error instanceof WebhookTransportError
          ? error.code
          : 'DELIVERY_FAILED';
      }

      const completed = this.clock();
      const completedAt = completed.toISOString();
      if (!lastErrorCode) {
        return {
          attempt,
          status: 'delivered',
          nextAttemptAt: completedAt,
          completedAt,
          lastResponseCode,
          failureCount: 0,
          disableEndpoint: false,
        };
      }

      const failureCount = endpoint.failureCount + 1;
      const unsafe = lastErrorCode === 'UNSAFE_URL' || lastErrorCode === 'UNSAFE_ADDRESS';
      const disableEndpoint = unsafe || failureCount >= this.disableAfterFailures;
      const dead = disableEndpoint || attempt >= this.maxAttempts;
      const random = this.random();
      const jitter = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0;
      const delay = Math.round(monitorBackoffMs(attempt - 1) * (1 + jitter * 0.25));
      return {
        attempt,
        status: dead ? 'dead' : 'pending',
        nextAttemptAt: dead ? completedAt : new Date(completed.getTime() + delay).toISOString(),
        completedAt: dead ? completedAt : undefined,
        lastResponseCode,
        lastErrorCode,
        failureCount,
        disableEndpoint,
      };
    });
  }

  private tick(): void {
    if (!this.running || this.inFlight) return;
    this.inFlight = (async () => {
      try {
        for (let count = 0; count < 25 && this.running; count += 1) {
          if (!await this.runOnce()) break;
        }
      } catch {
        emitOperationalFailure('webhook.worker');
      }
    })().finally(() => {
      this.inFlight = undefined;
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), this.pollMs);
    this.timer.unref();
    this.tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }
}

function configuredInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error(name + ' must be an integer from ' + min + ' through ' + max);
  }
  return boundedInteger(Number(raw), name, min, max);
}

export function startConfiguredWebhookWorker(
  storage: WebhookStorage | undefined
): WebhookWorker | undefined {
  if (process.env.WEBHOOKS_ENABLED !== 'true') return undefined;
  if (!storage) throw new Error('WEBHOOKS_ENABLED requires webhook storage');
  const worker = new WebhookWorker(storage, {
    encryptionKey: webhookEncryptionKey(),
    maxAttempts: configuredInteger('WEBHOOK_MAX_ATTEMPTS', 8, 1, 20),
    disableAfterFailures: configuredInteger('WEBHOOK_DISABLE_AFTER_FAILURES', 10, 1, 100),
  });
  worker.start();
  return worker;
}
