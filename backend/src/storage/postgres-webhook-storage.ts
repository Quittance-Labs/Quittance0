import type { Pool, PoolClient } from 'pg';
import type { WebhookSecrets } from '../services/webhook-crypto';
import { redactWebhookPayload } from '../utils/payment-event-redaction';
import {
  type DeliverWebhook,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookStorage,
  WebhookStoreError,
  newWebhookDelivery,
  testWebhookPayload,
} from './webhook-storage';

const iso = (value: string | Date): string => new Date(value).toISOString();
const optionalIso = (value: string | Date | null | undefined): string | undefined =>
  value == null ? undefined : iso(value);

function mapEndpoint(row: any): WebhookEndpoint {
  return {
    id: row.id,
    sellerPublicKey: row.seller_public_key,
    url: row.url,
    events: [...row.events],
    secretHash: row.secret_hash,
    secretEncrypted: row.secret_encrypted,
    previousSecretHash: row.previous_secret_hash ?? undefined,
    previousSecretEncrypted: row.previous_secret_encrypted ?? undefined,
    previousSecretExpiresAt: optionalIso(row.previous_secret_expires_at),
    enabled: row.enabled,
    failureCount: Number(row.failure_count),
    createdAt: iso(row.created_at),
    disabledAt: optionalIso(row.disabled_at),
    deletedAt: optionalIso(row.deleted_at),
  };
}

function mapDelivery(row: any): WebhookDelivery {
  return {
    id: row.id,
    eventId: row.event_id,
    endpointId: row.endpoint_id,
    eventType: row.event_type,
    payload: redactWebhookPayload(row.payload),
    attempt: Number(row.attempt),
    status: row.status,
    nextAttemptAt: iso(row.next_attempt_at),
    lastResponseCode: row.last_response_code ?? undefined,
    lastErrorCode: row.last_error_code ?? undefined,
    createdAt: iso(row.created_at),
    completedAt: optionalIso(row.completed_at),
  };
}

/**
 * Invoice triggers enqueue inside the invoice transaction. Delivery holds both
 * the endpoint and delivery row locks across bounded I/O, so another process
 * cannot post the same row or rotate/remove its signing key mid-attempt.
 */
export class PostgresWebhookStorage implements WebhookStorage {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let failedRollback = false;
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        failedRollback = true;
      }
      throw error;
    } finally {
      client.release(failedRollback);
    }
  }

  async register(endpoint: WebhookEndpoint): Promise<void> {
    await this.transaction(async client => {
      // Serialize each seller's count-and-insert across application processes.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 584))', [endpoint.sellerPublicKey]);
      const count = await client.query(
        'SELECT COUNT(*)::integer AS count FROM webhook_endpoints WHERE seller_public_key = $1 AND deleted_at IS NULL',
        [endpoint.sellerPublicKey]
      );
      if (Number(count.rows[0].count) >= 5) throw new WebhookStoreError('ENDPOINT_LIMIT');
      await client.query(
        `INSERT INTO webhook_endpoints (
          id, seller_public_key, url, events, secret_hash, secret_encrypted,
          previous_secret_hash, previous_secret_encrypted, previous_secret_expires_at,
          enabled, failure_count, created_at, disabled_at, deleted_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          endpoint.id, endpoint.sellerPublicKey, endpoint.url, endpoint.events,
          endpoint.secretHash, endpoint.secretEncrypted, endpoint.previousSecretHash ?? null,
          endpoint.previousSecretEncrypted ?? null, endpoint.previousSecretExpiresAt ?? null,
          endpoint.enabled, endpoint.failureCount, endpoint.createdAt,
          endpoint.disabledAt ?? null, endpoint.deletedAt ?? null,
        ]
      );
    });
  }

  async listEndpoints(sellerPublicKey: string): Promise<WebhookEndpoint[]> {
    const result = await this.pool.query(
      `SELECT * FROM webhook_endpoints
       WHERE seller_public_key = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC, id ASC`,
      [sellerPublicKey]
    );
    return result.rows.map(mapEndpoint);
  }

  async listDeliveries(sellerPublicKey: string): Promise<WebhookDelivery[]> {
    const result = await this.pool.query(
      `SELECT d.* FROM webhook_deliveries d
       JOIN webhook_endpoints e ON e.id = d.endpoint_id
       WHERE e.seller_public_key = $1
       ORDER BY d.created_at DESC, d.id DESC LIMIT 50`,
      [sellerPublicKey]
    );
    return result.rows.map(mapDelivery);
  }

  async remove(sellerPublicKey: string, id: string, now: Date): Promise<boolean> {
    return this.transaction(async client => {
      const endpoint = await client.query(
        `UPDATE webhook_endpoints
         SET enabled = false, disabled_at = $3, deleted_at = $3
         WHERE id = $2 AND seller_public_key = $1 AND deleted_at IS NULL RETURNING id`,
        [sellerPublicKey, id, now]
      );
      if (!endpoint.rows.length) return false;
      await client.query(
        `UPDATE webhook_deliveries
         SET status = 'cancelled', completed_at = $2, last_error_code = 'ENDPOINT_DISABLED'
         WHERE endpoint_id = $1 AND status = 'pending'`,
        [id, now]
      );
      return true;
    });
  }

  async rotate(
    sellerPublicKey: string,
    id: string,
    secrets: WebhookSecrets,
    now: Date,
    overlapMs: number
  ): Promise<WebhookEndpoint | undefined> {
    return this.transaction(async client => {
      const found = await client.query(
        `SELECT * FROM webhook_endpoints
         WHERE seller_public_key = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
        [sellerPublicKey, id]
      );
      if (!found.rows.length) return undefined;
      const current = mapEndpoint(found.rows[0]);
      if (current.previousSecretExpiresAt && new Date(current.previousSecretExpiresAt).getTime() > now.getTime()) {
        throw new WebhookStoreError('ROTATION_IN_PROGRESS');
      }
      const result = await client.query(
        `UPDATE webhook_endpoints
         SET previous_secret_hash = secret_hash,
             previous_secret_encrypted = secret_encrypted,
             previous_secret_expires_at = $5,
             secret_hash = $3, secret_encrypted = $4
         WHERE id = $2 AND seller_public_key = $1 RETURNING *`,
        [sellerPublicKey, id, secrets.secretHash, secrets.secretEncrypted, new Date(now.getTime() + overlapMs)]
      );
      return mapEndpoint(result.rows[0]);
    });
  }

  async enqueueTest(sellerPublicKey: string, id: string, eventId: string, now: Date): Promise<boolean> {
    return this.transaction(async client => {
      const endpoint = await client.query(
        `SELECT id FROM webhook_endpoints
         WHERE seller_public_key = $1 AND id = $2 AND enabled AND deleted_at IS NULL FOR UPDATE`,
        [sellerPublicKey, id]
      );
      if (!endpoint.rows.length) return false;
      const recent = await client.query(
        `SELECT id FROM webhook_deliveries
         WHERE endpoint_id = $1 AND payload->>'test' = 'true'
           AND created_at > $2::timestamptz - INTERVAL '1 minute' LIMIT 1`,
        [id, now]
      );
      if (recent.rows.length) throw new WebhookStoreError('TEST_RATE_LIMIT');
      const delivery = newWebhookDelivery(id, testWebhookPayload(eventId, now));
      await client.query(
        `INSERT INTO webhook_deliveries
         (id, endpoint_id, event_id, event_type, payload, attempt, next_attempt_at, status, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9)`,
        [
          delivery.id, delivery.endpointId, delivery.eventId, delivery.eventType,
          JSON.stringify(delivery.payload), delivery.attempt, delivery.nextAttemptAt,
          delivery.status, delivery.createdAt,
        ]
      );
      return true;
    });
  }

  async consumeProof(sellerPublicKey: string, nonce: string, expiresAt: Date, now: Date): Promise<boolean> {
    if (expiresAt.getTime() <= now.getTime()) return false;
    return this.transaction(async client => {
      await client.query('DELETE FROM webhook_proofs WHERE expires_at <= $1', [now]);
      const result = await client.query(
        `INSERT INTO webhook_proofs (seller_public_key, nonce, expires_at) VALUES ($1,$2,$3)
         ON CONFLICT (seller_public_key, nonce) DO NOTHING RETURNING nonce`,
        [sellerPublicKey, nonce, expiresAt]
      );
      return result.rows.length > 0;
    });
  }

  async processNext(now: Date, deliver: DeliverWebhook): Promise<boolean> {
    return this.transaction(async client => {
      // Retire pending rows for endpoints disabled or removed outside a worker.
      await client.query(
        `UPDATE webhook_deliveries d
         SET status = CASE WHEN e.deleted_at IS NOT NULL THEN 'cancelled' ELSE 'dead' END,
             completed_at = $1, last_error_code = 'ENDPOINT_DISABLED'
         FROM webhook_endpoints e
         WHERE d.endpoint_id = e.id AND d.status = 'pending'
           AND (NOT e.enabled OR e.deleted_at IS NOT NULL)`,
        [now]
      );
      const result = await client.query(
        `SELECT d.*, to_jsonb(e) AS endpoint
         FROM webhook_deliveries d JOIN webhook_endpoints e ON e.id = d.endpoint_id
         WHERE d.status = 'pending' AND d.next_attempt_at <= $1
           AND e.enabled AND e.deleted_at IS NULL
         ORDER BY d.next_attempt_at ASC, d.id ASC
         LIMIT 1 FOR UPDATE OF d, e SKIP LOCKED`,
        [now]
      );
      if (!result.rows.length) return false;
      const row = result.rows[0];
      const delivery = mapDelivery(row);
      const endpoint = mapEndpoint(row.endpoint);
      const attempt = await deliver(delivery, endpoint);
      await client.query(
        `UPDATE webhook_deliveries
         SET attempt = $2, status = $3, next_attempt_at = $4,
             last_response_code = $5, last_error_code = $6, completed_at = $7
         WHERE id = $1`,
        [
          delivery.id, attempt.attempt, attempt.status, attempt.nextAttemptAt,
          attempt.lastResponseCode ?? null, attempt.lastErrorCode ?? null, attempt.completedAt ?? null,
        ]
      );
      await client.query(
        `UPDATE webhook_endpoints
         SET failure_count = $2,
             enabled = CASE WHEN $3 THEN false ELSE enabled END,
             disabled_at = CASE WHEN $3 THEN COALESCE(disabled_at, $4) ELSE disabled_at END
         WHERE id = $1`,
        [endpoint.id, attempt.failureCount, attempt.disableEndpoint, now]
      );
      if (attempt.disableEndpoint) {
        await client.query(
          `UPDATE webhook_deliveries
           SET status = 'dead', completed_at = $2, last_error_code = 'ENDPOINT_DISABLED'
           WHERE endpoint_id = $1 AND status = 'pending'`,
          [endpoint.id, now]
        );
      }
      return true;
    });
  }
}
