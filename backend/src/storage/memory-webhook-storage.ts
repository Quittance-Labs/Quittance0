import type { WebhookPayload } from '../../../shared/webhooks';
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

const copyEndpoint = (endpoint: WebhookEndpoint): WebhookEndpoint => ({
  ...endpoint, events: [...endpoint.events],
});
const copyDelivery = (delivery: WebhookDelivery): WebhookDelivery => ({
  ...delivery, payload: redactWebhookPayload(delivery.payload),
});

/** Synchronous preparation/commit keeps invoices and their outbox atomic. */
export class MemoryWebhookStorage implements WebhookStorage {
  private readonly endpoints = new Map<string, WebhookEndpoint>();
  private readonly deliveries = new Map<string, WebhookDelivery>();
  private readonly proofs = new Map<string, number>();
  private readonly lockedEndpoints = new Set<string>();

  prepareEvent(sellerPublicKey: string, payload: WebhookPayload): () => void {
    const clean = redactWebhookPayload(payload);
    const prepared = [...this.endpoints.values()]
      .filter(endpoint =>
        endpoint.sellerPublicKey === sellerPublicKey &&
        endpoint.enabled && !endpoint.deletedAt && endpoint.events.includes(clean.type)
      )
      .map(endpoint => newWebhookDelivery(endpoint.id, clean));
    return () => {
      for (const delivery of prepared) this.deliveries.set(delivery.id, delivery);
    };
  }

  async register(endpoint: WebhookEndpoint): Promise<void> {
    const owned = [...this.endpoints.values()].filter(
      value => value.sellerPublicKey === endpoint.sellerPublicKey && !value.deletedAt
    );
    if (owned.length >= 5) throw new WebhookStoreError('ENDPOINT_LIMIT');
    if (this.endpoints.has(endpoint.id)) throw new Error('Webhook endpoint ID already exists');
    this.endpoints.set(endpoint.id, copyEndpoint(endpoint));
  }

  async listEndpoints(sellerPublicKey: string): Promise<WebhookEndpoint[]> {
    return [...this.endpoints.values()]
      .filter(endpoint => endpoint.sellerPublicKey === sellerPublicKey && !endpoint.deletedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map(copyEndpoint);
  }

  async listDeliveries(sellerPublicKey: string): Promise<WebhookDelivery[]> {
    return [...this.deliveries.values()]
      .filter(delivery => this.endpoints.get(delivery.endpointId)?.sellerPublicKey === sellerPublicKey)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, 50)
      .map(copyDelivery);
  }

  async remove(sellerPublicKey: string, id: string, now: Date): Promise<boolean> {
    const endpoint = this.endpoints.get(id);
    if (!endpoint || endpoint.sellerPublicKey !== sellerPublicKey || endpoint.deletedAt) return false;
    const at = now.toISOString();
    endpoint.enabled = false;
    endpoint.disabledAt = at;
    endpoint.deletedAt = at;
    for (const delivery of this.deliveries.values()) {
      if (delivery.endpointId === id && delivery.status === 'pending') {
        delivery.status = 'cancelled';
        delivery.completedAt = at;
        delivery.lastErrorCode = 'ENDPOINT_DISABLED';
      }
    }
    return true;
  }

  async rotate(
    sellerPublicKey: string,
    id: string,
    secrets: WebhookSecrets,
    now: Date,
    overlapMs: number
  ): Promise<WebhookEndpoint | undefined> {
    const endpoint = this.endpoints.get(id);
    if (!endpoint || endpoint.sellerPublicKey !== sellerPublicKey || endpoint.deletedAt) return undefined;
    if (endpoint.previousSecretExpiresAt && new Date(endpoint.previousSecretExpiresAt).getTime() > now.getTime()) {
      throw new WebhookStoreError('ROTATION_IN_PROGRESS');
    }
    const rotated: WebhookEndpoint = {
      ...endpoint,
      previousSecretHash: endpoint.secretHash,
      previousSecretEncrypted: endpoint.secretEncrypted,
      previousSecretExpiresAt: new Date(now.getTime() + overlapMs).toISOString(),
      secretHash: secrets.secretHash,
      secretEncrypted: secrets.secretEncrypted,
    };
    this.endpoints.set(id, rotated);
    return copyEndpoint(rotated);
  }

  async enqueueTest(sellerPublicKey: string, id: string, eventId: string, now: Date): Promise<boolean> {
    const endpoint = this.endpoints.get(id);
    if (!endpoint || endpoint.sellerPublicKey !== sellerPublicKey || endpoint.deletedAt || !endpoint.enabled) return false;
    const cutoff = now.getTime() - 60_000;
    if ([...this.deliveries.values()].some(delivery =>
      delivery.endpointId === id && delivery.payload.test === true &&
      new Date(delivery.createdAt).getTime() > cutoff
    )) {
      throw new WebhookStoreError('TEST_RATE_LIMIT');
    }
    const delivery = newWebhookDelivery(id, testWebhookPayload(eventId, now));
    this.deliveries.set(delivery.id, delivery);
    return true;
  }

  async consumeProof(sellerPublicKey: string, nonce: string, expiresAt: Date, now: Date): Promise<boolean> {
    const timestamp = now.getTime();
    for (const [key, expiry] of this.proofs) {
      if (expiry <= timestamp) this.proofs.delete(key);
    }
    if (expiresAt.getTime() <= timestamp) return false;
    const key = sellerPublicKey + ':' + nonce;
    if (this.proofs.has(key)) return false;
    this.proofs.set(key, expiresAt.getTime());
    return true;
  }

  async processNext(now: Date, deliver: DeliverWebhook): Promise<boolean> {
    const next = [...this.deliveries.values()]
      .filter(delivery => {
        const endpoint = this.endpoints.get(delivery.endpointId);
        return delivery.status === 'pending' &&
          new Date(delivery.nextAttemptAt).getTime() <= now.getTime() &&
          endpoint?.enabled && !endpoint.deletedAt && !this.lockedEndpoints.has(endpoint.id);
      })
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt) || a.id.localeCompare(b.id))[0];
    if (!next) return false;
    const endpoint = this.endpoints.get(next.endpointId)!;
    this.lockedEndpoints.add(endpoint.id);
    try {
      const result = await deliver(copyDelivery(next), copyEndpoint(endpoint));
      // Removal is synchronous and can happen while delivery is in flight.
      // Preserve it rather than restoring the endpoint snapshot passed to I/O.
      const current = this.endpoints.get(endpoint.id)!;
      const removed = Boolean(current.deletedAt);
      Object.assign(next, {
        attempt: result.attempt,
        status: removed ? 'cancelled' : result.status,
        nextAttemptAt: result.nextAttemptAt,
        lastResponseCode: result.lastResponseCode,
        lastErrorCode: removed ? 'ENDPOINT_DISABLED' : result.lastErrorCode,
        completedAt: removed ? current.deletedAt : result.completedAt,
      });
      current.failureCount = result.failureCount;
      if (result.disableEndpoint && !removed) {
        current.enabled = false;
        current.disabledAt = now.toISOString();
        for (const delivery of this.deliveries.values()) {
          if (delivery.endpointId === current.id && delivery.status === 'pending') {
            delivery.status = 'dead';
            delivery.completedAt = now.toISOString();
            delivery.lastErrorCode = 'ENDPOINT_DISABLED';
          }
        }
      }
      return true;
    } finally {
      this.lockedEndpoints.delete(endpoint.id);
    }
  }

  clear(): void {
    this.endpoints.clear();
    this.deliveries.clear();
    this.proofs.clear();
    this.lockedEndpoints.clear();
  }
}
