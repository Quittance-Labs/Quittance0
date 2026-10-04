import { randomUUID } from 'node:crypto';
import type { WebhookEventType, WebhookPayload } from '../../../shared/webhooks';
import type { WebhookSecrets } from '../services/webhook-crypto';
import type { StoredInvoice } from './invoice-storage';
import { canonicalAmount } from '../utils/safe-amount-compare';
import { redactWebhookPayload } from '../utils/payment-event-redaction';

export interface WebhookEndpoint extends WebhookSecrets {
  id: string;
  sellerPublicKey: string;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  failureCount: number;
  createdAt: string;
  disabledAt?: string;
  deletedAt?: string;
}

export interface WebhookDelivery {
  id: string;
  eventId: string;
  endpointId: string;
  eventType: WebhookEventType;
  payload: WebhookPayload;
  attempt: number;
  status: 'pending' | 'delivered' | 'dead' | 'cancelled';
  nextAttemptAt: string;
  lastResponseCode?: number;
  lastErrorCode?: string;
  createdAt: string;
  completedAt?: string;
}

export type WebhookAttemptResult = Pick<
  WebhookDelivery,
  'attempt' | 'status' | 'nextAttemptAt' | 'lastResponseCode' | 'lastErrorCode' | 'completedAt'
> & { failureCount: number; disableEndpoint: boolean };

export type DeliverWebhook = (
  delivery: WebhookDelivery,
  endpoint: WebhookEndpoint
) => Promise<WebhookAttemptResult>;

export class WebhookStoreError extends Error {
  constructor(
    readonly code: 'ENDPOINT_LIMIT' | 'ENDPOINT_NOT_FOUND' | 'ROTATION_IN_PROGRESS' | 'TEST_RATE_LIMIT'
  ) {
    super(code);
    this.name = 'WebhookStoreError';
  }
}

export interface WebhookStorage {
  register(endpoint: WebhookEndpoint): Promise<void>;
  listEndpoints(sellerPublicKey: string): Promise<WebhookEndpoint[]>;
  listDeliveries(sellerPublicKey: string): Promise<WebhookDelivery[]>;
  remove(sellerPublicKey: string, id: string, now: Date): Promise<boolean>;
  rotate(
    sellerPublicKey: string,
    id: string,
    secrets: WebhookSecrets,
    now: Date,
    overlapMs: number
  ): Promise<WebhookEndpoint | undefined>;
  enqueueTest(sellerPublicKey: string, id: string, eventId: string, now: Date): Promise<boolean>;
  consumeProof(sellerPublicKey: string, nonce: string, expiresAt: Date, now: Date): Promise<boolean>;
  processNext(now: Date, deliver: DeliverWebhook): Promise<boolean>;
}

export function publicWebhookEndpoint(endpoint: WebhookEndpoint) {
  return {
    id: endpoint.id,
    url: endpoint.url,
    events: [...endpoint.events],
    enabled: endpoint.enabled,
    failureCount: endpoint.failureCount,
    createdAt: endpoint.createdAt,
    ...(endpoint.disabledAt ? { disabledAt: endpoint.disabledAt } : {}),
  };
}

export function publicWebhookDelivery(delivery: WebhookDelivery) {
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    endpointId: delivery.endpointId,
    eventType: delivery.eventType,
    attempt: delivery.attempt,
    status: delivery.status,
    nextAttemptAt: delivery.nextAttemptAt,
    createdAt: delivery.createdAt,
    ...(delivery.lastResponseCode !== undefined ? { lastResponseCode: delivery.lastResponseCode } : {}),
    ...(delivery.lastErrorCode ? { lastErrorCode: delivery.lastErrorCode } : {}),
    ...(delivery.completedAt ? { completedAt: delivery.completedAt } : {}),
  };
}

export function invoiceWebhookPayload(
  type: WebhookEventType,
  invoice: StoredInvoice,
  eventId: string = randomUUID(),
  at = new Date(),
  payment?: Record<string, unknown>
): WebhookPayload {
  return redactWebhookPayload({
    version: 1,
    id: eventId,
    type,
    createdAt: at.toISOString(),
    invoice: {
      id: invoice.id,
      amount: canonicalAmount(invoice.amount),
      assetCode: invoice.assetCode,
      assetIssuer: invoice.assetIssuer,
      status: invoice.status,
      paymentTxHash: invoice.paymentTxHash,
      settledAt: invoice.settledAt?.toISOString(),
      settlementContext: invoice.settlementContext,
      priorStatus: invoice.priorStatus,
      latePaymentWarningCode: invoice.latePaymentWarningCode,
      expiresAt: invoice.expiresAt.toISOString(),
    },
    payment,
  });
}

export function testWebhookPayload(id: string, at: Date): WebhookPayload {
  return redactWebhookPayload({
    version: 1,
    id,
    type: 'invoice.created',
    createdAt: at.toISOString(),
    test: true,
  });
}

export function newWebhookDelivery(endpointId: string, payload: WebhookPayload): WebhookDelivery {
  return {
    id: randomUUID(),
    eventId: payload.id,
    endpointId,
    eventType: payload.type,
    payload,
    attempt: 0,
    status: 'pending',
    nextAttemptAt: payload.createdAt,
    createdAt: payload.createdAt,
  };
}
