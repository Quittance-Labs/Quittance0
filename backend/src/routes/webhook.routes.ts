import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import {
  WEBHOOK_EVENT_TYPES,
  webhookProofMessage,
  type WebhookAction,
  type WebhookEventType,
} from '../../../shared/webhooks';
import { createRateLimiter, getClientIp } from '../middleware/rate-limit';
import { emitOperationalFailure } from '../observability/log-events';
import {
  WebhookStoreError,
  publicWebhookDelivery,
  publicWebhookEndpoint,
  type WebhookEndpoint,
  type WebhookStorage,
} from '../storage/webhook-storage';
import { newWebhookSecret, webhookEncryptionKey } from '../services/webhook-crypto';
import {
  validateWebhookUrl,
  WebhookTransportError,
  type WebhookResolver,
} from '../services/webhook-transport';
import { verifySellerSignature } from '../utils/signature-verification';

export interface WebhookRouterOptions {
  encryptionKey?: Buffer;
  enabled?: boolean;
  clock?: () => Date;
  resolve?: WebhookResolver;
}

const UUID = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
const eventTypes: ReadonlySet<string> = new Set(WEBHOOK_EVENT_TYPES);

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, code, error: message });
}

export function createWebhookRouter(
  storage: WebhookStorage,
  options: WebhookRouterOptions = {}
): Router {
  const router = Router();
  const clock = options.clock ?? (() => new Date());
  const enabled = options.enabled ?? process.env.WEBHOOKS_ENABLED === 'true';
  const encryptionKey = options.encryptionKey ?? (enabled ? webhookEncryptionKey() : undefined);
  if (encryptionKey && encryptionKey.length !== 32) {
    throw new Error('Webhook encryption requires a 32-byte key');
  }

  router.use('/webhooks', (_req: Request, res: Response, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  }, createRateLimiter({
    windowMs: 60_000,
    max: 60,
    keyGenerator: (req) => 'manage_webhooks:' + getClientIp(req),
    code: 'WEBHOOK_RATE_LIMIT_EXCEEDED',
    message: 'Too many webhook management requests. Please retry later.',
  }));

  function handler(action: WebhookAction): RequestHandler {
    return async (req: Request, res: Response): Promise<void> => {
      try {
        const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body)
          ? req.body as Record<string, unknown>
          : {};
        const endpointId = typeof req.params.id === 'string' ? req.params.id : undefined;
        if (
          action !== 'list' &&
          action !== 'register' &&
          (!endpointId || !UUID.test(endpointId))
        ) {
          fail(res, 400, 'INVALID_ENDPOINT_ID', 'Provide a valid webhook endpoint ID.');
          return;
        }

        const { sellerPublicKey, signature, timestamp, nonce } = body;
        if (
          typeof sellerPublicKey !== 'string' ||
          typeof signature !== 'string' ||
          timestamp === undefined ||
          typeof nonce !== 'string'
        ) {
          fail(res, 401, 'WEBHOOK_PROOF_REQUIRED', 'A signed seller wallet proof is required.');
          return;
        }

        const now = clock();
        if (
          sellerPublicKey.length !== 56 ||
          signature.length === 0 ||
          signature.length > 256 ||
          typeof timestamp !== 'number' ||
          !Number.isSafeInteger(timestamp) ||
          !UUID.test(nonce) ||
          now.getTime() - timestamp * 1000 >= 300_000 ||
          timestamp * 1000 - now.getTime() > 30_000
        ) {
          fail(res, 401, 'INVALID_WEBHOOK_PROOF', 'The wallet proof is invalid or has expired.');
          return;
        }

        let url: string | undefined;
        let events: WebhookEventType[] | undefined;
        if (action === 'register') {
          if (
            typeof body.url !== 'string' ||
            body.url.length === 0 ||
            body.url.length > 2048 ||
            !Array.isArray(body.events) ||
            body.events.length < 1 ||
            body.events.length > WEBHOOK_EVENT_TYPES.length ||
            !body.events.every((event): event is WebhookEventType =>
              typeof event === 'string' && eventTypes.has(event)) ||
            new Set(body.events).size !== body.events.length
          ) {
            fail(res, 400, 'INVALID_WEBHOOK', 'Provide an HTTPS URL and one or more distinct supported events.');
            return;
          }
          url = body.url;
          events = body.events;
        }

        const message = webhookProofMessage({
          sellerPublicKey,
          action,
          endpointId,
          url,
          events,
          timestamp,
          nonce,
        });
        if (!verifySellerSignature(sellerPublicKey, signature, [message])) {
          fail(res, 401, 'INVALID_WEBHOOK_PROOF', 'The wallet proof is invalid or has expired.');
          return;
        }

        if (action !== 'list' && action !== 'remove' && (!enabled || !encryptionKey)) {
          fail(res, 503, 'WEBHOOKS_DISABLED', 'Webhook delivery is not enabled on this server.');
          return;
        }
        const consumed = await storage.consumeProof(
          sellerPublicKey, nonce, new Date((timestamp + 300) * 1000), now
        );
        if (!consumed) {
          fail(res, 409, 'WEBHOOK_PROOF_REPLAYED', 'This wallet proof has already been used.');
          return;
        }

        if (action === 'list') {
          const [endpoints, deliveries] = await Promise.all([
            storage.listEndpoints(sellerPublicKey),
            storage.listDeliveries(sellerPublicKey),
          ]);
          res.json({
            success: true,
            data: {
              endpoints: endpoints.map(publicWebhookEndpoint),
              deliveries: deliveries.map(publicWebhookDelivery),
            },
          });
          return;
        }

        if (action === 'register') {
          const validated = await validateWebhookUrl(url!, options.resolve);
          const { secret, ...secrets } = newWebhookSecret(encryptionKey!);
          const endpoint: WebhookEndpoint = {
            id: randomUUID(),
            sellerPublicKey,
            url: validated.url.href,
            events: events!,
            enabled: true,
            failureCount: 0,
            createdAt: now.toISOString(),
            ...secrets,
          };
          await storage.register(endpoint);
          res.status(201).json({
            success: true,
            data: { endpoint: publicWebhookEndpoint(endpoint), secret },
          });
          return;
        }

        if (action === 'remove') {
          if (!await storage.remove(sellerPublicKey, endpointId!, now)) {
            fail(res, 404, 'ENDPOINT_NOT_FOUND', 'Webhook endpoint not found.');
            return;
          }
          res.json({ success: true, data: { id: endpointId, removed: true } });
          return;
        }

        if (action === 'rotate') {
          const { secret, ...secrets } = newWebhookSecret(encryptionKey!);
          const endpoint = await storage.rotate(
            sellerPublicKey, endpointId!, secrets, now, 86_400_000
          );
          if (!endpoint) {
            fail(res, 404, 'ENDPOINT_NOT_FOUND', 'Webhook endpoint not found.');
            return;
          }
          res.json({
            success: true,
            data: {
              endpoint: publicWebhookEndpoint(endpoint),
              secret,
              previousSecretExpiresAt: endpoint.previousSecretExpiresAt,
            },
          });
          return;
        }

        const eventId = randomUUID();
        if (!await storage.enqueueTest(sellerPublicKey, endpointId!, eventId, now)) {
          fail(res, 404, 'ENDPOINT_NOT_FOUND', 'Webhook endpoint not found.');
          return;
        }
        res.status(202).json({ success: true, data: { eventId } });
      } catch (error) {
        if (error instanceof WebhookStoreError) {
          switch (error.code) {
            case 'ENDPOINT_LIMIT':
              fail(res, 400, error.code, 'The webhook endpoint limit has been reached.');
              return;
            case 'ENDPOINT_NOT_FOUND':
              fail(res, 404, error.code, 'Webhook endpoint not found.');
              return;
            case 'ROTATION_IN_PROGRESS':
              fail(res, 409, error.code, 'The previous signing secret is still in its rotation window.');
              return;
            case 'TEST_RATE_LIMIT':
              fail(res, 429, error.code, 'Wait before sending another test event.');
              return;
          }
        }
        if (error instanceof WebhookTransportError) {
          fail(res, 400, 'INVALID_WEBHOOK', 'The endpoint must resolve to a public HTTPS address without credentials or a fragment.');
          return;
        }
        emitOperationalFailure('webhook.manage');
        fail(res, 503, 'WEBHOOK_UNAVAILABLE', 'Webhook management is temporarily unavailable.');
      }
    };
  }

  router.post('/webhooks', handler('register'));
  router.post('/webhooks/list', handler('list'));
  router.post('/webhooks/:id/remove', handler('remove'));
  router.post('/webhooks/:id/rotate', handler('rotate'));
  router.post('/webhooks/:id/test', handler('test'));
  return router;
}
