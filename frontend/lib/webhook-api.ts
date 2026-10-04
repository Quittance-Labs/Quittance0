import { signBlob } from '@stellar/freighter-api';
import { webhookProofMessage, type WebhookAction, type WebhookEventType } from '@shared/webhooks';
import api from './api';
import { assertFreighterReady, EXPECTED_WALLET_NETWORK, type FreighterSession } from '@/lib/stellar';
import { useWalletStore, type WalletState } from './store';
import { walletSessionGate } from './wallet-session';

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: WebhookEventType[];
  enabled: boolean;
  failureCount: number;
  createdAt: string;
  disabledAt?: string | null;
}

export interface WebhookDelivery {
  id: string;
  eventId: string;
  endpointId: string;
  eventType: WebhookEventType;
  attempt: number;
  status: 'pending' | 'delivered' | 'dead' | 'cancelled';
  nextAttemptAt?: string | null;
  lastResponseCode?: number | null;
  lastErrorCode?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface WebhookList {
  endpoints: WebhookEndpoint[];
  deliveries: WebhookDelivery[];
}

export interface WebhookSecretResult {
  endpoint: WebhookEndpoint;
  secret: string;
  previousSecretExpiresAt?: string;
}

type WalletContext = Pick<WalletState,
  'publicKey' | 'connected' | 'network' | 'networkPassphrase' | 'freighterAvailable'>;

/** Include the passphrase: a custom network can reuse the TESTNET name. */
export function webhookWalletContext(wallet: WalletContext): string {
  return JSON.stringify([
    wallet.publicKey,
    wallet.connected,
    wallet.network?.toUpperCase() ?? null,
    wallet.networkPassphrase ?? null,
    wallet.freighterAvailable ?? null,
  ]);
}

export interface WebhookRequestContext {
  sellerPublicKey: string;
  walletContext: string;
  signal?: AbortSignal;
}

type ActionFields = { endpointId?: string; url?: string; events?: WebhookEventType[] };

function walletChanged(): Error {
  return new Error('The connected wallet or network changed. Please try the action again.');
}

function utf8Base64(message: string): string {
  let bytes = '';
  for (const byte of new TextEncoder().encode(message)) bytes += String.fromCharCode(byte);
  return btoa(bytes);
}

function signatureFrom(result: unknown): string {
  const record = result && typeof result === 'object'
    ? result as { error?: unknown; signedBlob?: unknown; signature?: unknown }
    : null;
  const value = typeof result === 'string'
    ? result
    : record?.error ? null : record?.signedBlob ?? record?.signature;
  if (typeof value === 'string' && value) {
    // Older Freighter versions return a string; newer versions return an object.
    // The wire contract is always a base64 encoded Ed25519 signature.
    if (/^[0-9a-f]{128}$/i.test(value)) {
      return btoa(value.match(/../g)!.map((byte) => String.fromCharCode(parseInt(byte, 16))).join(''));
    }
    try {
      if (atob(value).length === 64) return value;
    } catch { /* Report a missing signature without logging the wallet result. */ }
  }
  throw new Error('Freighter did not return a valid signature. Please try again.');
}

function sameFreighterSession(before: FreighterSession, after: FreighterSession): boolean {
  return before.publicKey === after.publicKey &&
    before.network?.toUpperCase() === after.network?.toUpperCase() &&
    before.networkPassphrase === after.networkPassphrase;
}

async function request<T>(context: WebhookRequestContext, action: WebhookAction, fields: ActionFields = {}): Promise<T> {
  const abort = new AbortController();
  let invalidated = false;
  const invalidate = () => {
    invalidated = true;
    abort.abort();
  };
  const assertCurrent = () => {
    const wallet = useWalletStore.getState();
    if (invalidated || context.signal?.aborted ||
        wallet.publicKey !== context.sellerPublicKey ||
        webhookWalletContext(wallet) !== context.walletContext ||
        !walletSessionGate(wallet, EXPECTED_WALLET_NETWORK).ready) {
      throw walletChanged();
    }
  };
  // Invalidate even an A -> B -> A switch while the signing popup is open.
  const unsubscribe = useWalletStore.subscribe((wallet) => {
    if (webhookWalletContext(wallet) !== context.walletContext) invalidate();
  });
  context.signal?.addEventListener('abort', invalidate, { once: true });
  try {
    assertCurrent();
    const before = await assertFreighterReady();
    assertCurrent();
    if (before.publicKey !== context.sellerPublicKey) throw walletChanged();

    const proof = {
      sellerPublicKey: context.sellerPublicKey,
      action,
      ...fields,
      timestamp: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
    };
    const signature = signatureFrom(await signBlob(utf8Base64(webhookProofMessage(proof)), {
      accountToSign: context.sellerPublicKey,
    }));
    assertCurrent();
    const after = await assertFreighterReady();
    assertCurrent();
    if (!sameFreighterSession(before, after)) throw walletChanged();
    if (Math.floor(Date.now() / 1000) - proof.timestamp >= 300) {
      throw new Error('This wallet signature has expired. Please try the action again.');
    }

    const path = action === 'register' ? '/webhooks'
      : action === 'list' ? '/webhooks/list'
        : `/webhooks/${encodeURIComponent(fields.endpointId!)}/${action}`;
    const { action: _action, endpointId: _endpointId, ...body } = proof;
    const response = await api.post(path, { ...body, signature }, { signal: abort.signal });
    assertCurrent();
    if (response.data?.success !== true || !response.data?.data) {
      throw new Error(response.data?.error || 'The webhook action could not be completed.');
    }
    return response.data.data as T;
  } catch (error) {
    if (invalidated || context.signal?.aborted) throw walletChanged();
    throw error;
  } finally {
    unsubscribe();
    context.signal?.removeEventListener('abort', invalidate);
  }
}

export const webhookApi = {
  list: (context: WebhookRequestContext) => request<WebhookList>(context, 'list'),
  register: (context: WebhookRequestContext, rawUrl: string, events: WebhookEventType[]) => {
    let url: URL;
    try { url = new URL(rawUrl.trim()); } catch { throw new Error('Enter a valid HTTPS endpoint URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error('Use an HTTPS URL without credentials or a fragment.');
    }
    if (events.length === 0) throw new Error('Select at least one invoice event.');
    // Normalize before signing, then send the exact same URL and event filter.
    return request<WebhookSecretResult>(context, 'register', { url: url.toString(), events: [...events] });
  },
  remove: (context: WebhookRequestContext, endpointId: string) =>
    request<{ id: string; removed: true }>(context, 'remove', { endpointId }),
  rotate: (context: WebhookRequestContext, endpointId: string) =>
    request<WebhookSecretResult>(context, 'rotate', { endpointId }),
  test: (context: WebhookRequestContext, endpointId: string) =>
    request<{ eventId: string }>(context, 'test', { endpointId }),
};
