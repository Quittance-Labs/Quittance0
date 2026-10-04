'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@shared/webhooks';
import { useWalletStore } from '@/lib/store';
import { EXPECTED_WALLET_NETWORK } from '@/lib/stellar';
import { walletSessionGate } from '@/lib/wallet-session';
import {
  webhookApi,
  webhookWalletContext,
  type WebhookEndpoint,
  type WebhookList,
  type WebhookRequestContext,
  type WebhookSecretResult,
} from '@/lib/webhook-api';

const EVENT_LABELS: Record<WebhookEventType, string> = {
  'invoice.created': 'Invoice created',
  'invoice.paid': 'Invoice paid',
  'invoice.cancelled': 'Invoice cancelled',
  'invoice.expired': 'Invoice expired',
  'payment.rejected': 'Payment rejected',
};

const STATUS_LABELS = {
  pending: 'Pending',
  delivered: 'Delivered',
  dead: 'Failed permanently',
  cancelled: 'Cancelled',
};

function dateLabel(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

/** The keyed subtree clears secrets and responses on any wallet/network change. */
export default function SellerWebhooksPanel() {
  const wallet = useWalletStore();
  const gate = walletSessionGate(wallet, EXPECTED_WALLET_NETWORK);
  if (!gate.ready || !wallet.publicKey) return null;
  const context = webhookWalletContext(wallet);
  return <SellerWebhooksContent key={context} sellerPublicKey={wallet.publicKey} walletContext={context} />;
}

function SellerWebhooksContent({ sellerPublicKey, walletContext }: Omit<WebhookRequestContext, 'signal'>) {
  const [data, setData] = useState<WebhookList | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEventType[]>([...WEBHOOK_EVENT_TYPES]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secret, setSecret] = useState<WebhookSecretResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const active = useRef(true);
  const inFlight = useRef(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      abort.current?.abort();
    };
  }, []);

  async function run(label: string, action: (context: WebhookRequestContext) => Promise<() => void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      const commit = await action({ sellerPublicKey, walletContext, signal: controller.signal });
      if (active.current && !controller.signal.aborted &&
          webhookWalletContext(useWalletStore.getState()) === walletContext) commit();
    } catch (caught) {
      if (active.current && !controller.signal.aborted) {
        setError(caught instanceof Error ? caught.message : 'The webhook action could not be completed.');
      }
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(null);
    }
  }

  function upsertEndpoint(endpoint: WebhookEndpoint) {
    setData((previous) => ({
      endpoints: [endpoint, ...(previous?.endpoints ?? []).filter((item) => item.id !== endpoint.id)],
      deliveries: previous?.deliveries ?? [],
    }));
  }

  function revealSecret(result: WebhookSecretResult) {
    upsertEndpoint(result.endpoint);
    setSecret(result);
    setCopied(false);
  }

  function load() {
    void run('Loading endpoints', async (context) => {
      const result = await webhookApi.list(context);
      return () => {
        setData(result);
        setHasLoaded(true);
        setRemoveId(null);
        setNotice('Endpoints and recent deliveries are up to date.');
      };
    });
  }

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (secret) return;
    void run('Adding endpoint', async (context) => {
      const result = await webhookApi.register(context, url, events);
      return () => {
        revealSecret(result);
        setUrl('');
        setNotice('Endpoint added. Save its signing secret below.');
      };
    });
  }

  function rotate(endpointId: string) {
    if (secret) return;
    void run('Rotating signing secret', async (context) => {
      const result = await webhookApi.rotate(context, endpointId);
      return () => {
        revealSecret(result);
        setNotice('Signing secret rotated. Update the secret in your receiver.');
      };
    });
  }

  function remove(endpointId: string) {
    void run('Removing endpoint', async (context) => {
      await webhookApi.remove(context, endpointId);
      return () => {
        setData((previous) => previous ? {
          endpoints: previous.endpoints.filter((endpoint) => endpoint.id !== endpointId),
          // A refresh obtains the final delivery status from the server.
          deliveries: previous.deliveries.filter((delivery) => delivery.endpointId !== endpointId),
        } : null);
        if (secret?.endpoint.id === endpointId) setSecret(null);
        setRemoveId(null);
        setNotice('Endpoint removed. Refresh to load the latest delivery history.');
      };
    });
  }

  function sendTest(endpointId: string) {
    void run('Queuing test delivery', async (context) => {
      const result = await webhookApi.test(context, endpointId);
      return () => setNotice(`Test event queued: ${result.eventId}. Refresh shortly to check its delivery.`);
    });
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.secret);
      if (active.current && webhookWalletContext(useWalletStore.getState()) === walletContext) setCopied(true);
    } catch {
      if (active.current) setError('Could not copy automatically. Select and copy the signing secret below.');
    }
  }

  return (
    <section aria-labelledby="seller-webhooks-heading" className="card mt-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h2 id="seller-webhooks-heading" className="text-xl font-semibold text-gray-900">Webhooks</h2>
          <p className="mt-1 text-sm text-gray-600">Receive signed invoice updates in your own system.</p>
          <p className="mt-1 text-xs text-gray-600">Approve a Freighter wallet signature for each action.</p>
        </div>
        <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={load}>
          {hasLoaded ? 'Refresh webhooks' : 'Load endpoints'}
        </button>
      </div>

      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-gray-700 mb-3 break-words">
        {busy ? `${busy}. Check Freighter if a signature is requested.` : notice}
      </p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 mb-4">{error}</p>}

      {secret && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 mb-6" role="region" aria-labelledby="webhook-secret-heading">
          <h3 id="webhook-secret-heading" className="font-semibold text-amber-950">Copy and save this signing secret now</h3>
          <p className="text-sm text-amber-950 mt-1">It is shown once. Store it securely on the server that receives your webhooks.</p>
          <p className="text-xs text-amber-950 mt-1 break-all">{secret.endpoint.url}</p>
          <label htmlFor="webhook-signing-secret" className="sr-only">Signing secret</label>
          <textarea id="webhook-signing-secret" value={secret.secret} readOnly rows={2} autoComplete="off" spellCheck={false}
            className="input mt-3 w-full font-mono text-sm" onFocus={(event) => event.target.select()} />
          {secret.previousSecretExpiresAt && (
            <p className="mt-2 text-sm text-amber-950">The previous secret remains valid until {dateLabel(secret.previousSecretExpiresAt)}.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" onClick={() => void copySecret()} className="btn btn-primary">{copied ? 'Secret copied' : 'Copy secret'}</button>
            <button type="button" onClick={() => { setSecret(null); setCopied(false); }} className="btn border border-amber-500 text-amber-950">I&apos;ve saved it</button>
          </div>
        </div>
      )}

      <form onSubmit={register} className="border border-gray-200 rounded-lg p-4 mb-6">
        <h3 className="font-semibold text-gray-900 mb-3">Add an endpoint</h3>
        <fieldset disabled={Boolean(busy) || Boolean(secret)} className="space-y-4">
          <div>
            <label htmlFor="webhook-url" className="block text-sm font-medium text-gray-800 mb-1">Endpoint URL</label>
            <input id="webhook-url" type="url" required maxLength={2048} value={url} onChange={(event) => setUrl(event.target.value)}
              placeholder="https://your-service.example/webhooks/quittance" autoComplete="off" spellCheck={false}
              className="input w-full" aria-describedby="webhook-url-help" />
            <p id="webhook-url-help" className="mt-1 text-xs text-gray-600">Use a public HTTPS endpoint that accepts POST requests.</p>
          </div>
          <fieldset>
            <legend className="text-sm font-medium text-gray-800 mb-2">Events to receive</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {WEBHOOK_EVENT_TYPES.map((eventType) => (
                <label key={eventType} className="inline-flex items-center gap-2 text-sm text-gray-800">
                  <input type="checkbox" checked={events.includes(eventType)} onChange={(event) => {
                    setEvents((previous) => event.target.checked
                      ? [...previous, eventType]
                      : previous.filter((value) => value !== eventType));
                  }} className="h-4 w-4 accent-cyan-700" />
                  {EVENT_LABELS[eventType]}
                </label>
              ))}
            </div>
          </fieldset>
          <button type="submit" className="btn btn-primary" disabled={events.length === 0}>Add endpoint</button>
        </fieldset>
        {secret && <p className="mt-3 text-sm text-gray-700">Save the current secret before creating or rotating another one.</p>}
      </form>

      <h3 className="font-semibold text-gray-900 mb-3">Your endpoints</h3>
      {data && !hasLoaded && <p className="text-sm text-gray-600 mb-3">Showing changes from this visit. Load endpoints to see all endpoints for this wallet.</p>}
      {!data ? (
        <p className="text-sm text-gray-600">Load your endpoints and delivery history with a wallet signature.</p>
      ) : data.endpoints.length === 0 ? (
        <p className="text-sm text-gray-600">No endpoints registered for this wallet.</p>
      ) : (
        <ul className="space-y-3">
          {data.endpoints.map((endpoint) => (
            <li key={endpoint.id} className="rounded-lg border border-gray-200 p-4">
              <p className="font-mono text-sm text-gray-900 break-all">{endpoint.url}</p>
              <p className="mt-1 text-sm text-gray-700">{endpoint.enabled ? 'Enabled' : 'Disabled'} · {endpoint.failureCount} consecutive delivery failures</p>
              <p className="mt-2 text-xs text-gray-600">{endpoint.events.map((value) => EVENT_LABELS[value] ?? value).join(', ')}</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button type="button" className="btn border border-gray-300 text-gray-800" disabled={Boolean(busy) || !endpoint.enabled}
                  aria-label={`Send test event to ${endpoint.url}`} onClick={() => sendTest(endpoint.id)}>Send test event</button>
                <button type="button" className="btn border border-gray-300 text-gray-800" disabled={Boolean(busy) || Boolean(secret)}
                  aria-label={`Rotate signing secret for ${endpoint.url}`} onClick={() => rotate(endpoint.id)}>Rotate secret</button>
                <button type="button" className="btn border border-red-200 text-red-800" disabled={Boolean(busy)}
                  aria-label={`Remove endpoint ${endpoint.url}`} onClick={() => setRemoveId(endpoint.id)}>Remove</button>
              </div>
              {removeId === endpoint.id && (
                <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-900">
                  <p>Remove this endpoint?</p>
                  <div className="flex gap-3 mt-2">
                    <button type="button" disabled={Boolean(busy)} className="btn border border-red-300" onClick={() => remove(endpoint.id)}>Confirm removal</button>
                    <button type="button" disabled={Boolean(busy)} className="btn" onClick={() => setRemoveId(null)}>Keep endpoint</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {data && (
        <div className="mt-6">
          <h3 id="webhook-deliveries-heading" className="font-semibold text-gray-900 mb-3">Recent deliveries</h3>
          {data.deliveries.length === 0 ? <p className="text-sm text-gray-600">No recent deliveries. Send a test event to check an enabled endpoint.</p> : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm text-left" aria-labelledby="webhook-deliveries-heading">
                <caption className="sr-only">Up to 50 recent webhook deliveries. Refresh to check delivery status.</caption>
                <thead className="border-b border-gray-200 text-gray-700">
                  <tr>
                    <th scope="col" className="p-2">Event</th>
                    <th scope="col" className="p-2">Endpoint</th>
                    <th scope="col" className="p-2">Status</th>
                    <th scope="col" className="p-2">Attempts</th>
                    <th scope="col" className="p-2">Last response</th>
                    <th scope="col" className="p-2">Next attempt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.deliveries.map((delivery) => (
                    <tr key={delivery.id} className="align-top text-gray-800">
                      <th scope="row" className="p-2 font-normal">
                        <p className="font-medium">{EVENT_LABELS[delivery.eventType] ?? delivery.eventType}</p>
                        <p className="text-xs font-mono break-all mt-1">{delivery.eventId}</p>
                        <p className="text-xs text-gray-600 mt-1">{dateLabel(delivery.createdAt)}</p>
                      </th>
                      <td className="p-2 max-w-xs break-all text-xs">{data.endpoints.find((endpoint) => endpoint.id === delivery.endpointId)?.url ?? 'Removed endpoint'}</td>
                      <td className="p-2 whitespace-nowrap">{STATUS_LABELS[delivery.status] ?? delivery.status}</td>
                      <td className="p-2">{delivery.attempt}</td>
                      <td className="p-2">{delivery.lastResponseCode ? `HTTP ${delivery.lastResponseCode}` : delivery.lastErrorCode ?? '—'}</td>
                      <td className="p-2 whitespace-nowrap">{delivery.status === 'pending' ? dateLabel(delivery.nextAttemptAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
