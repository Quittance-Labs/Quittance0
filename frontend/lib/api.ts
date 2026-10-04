import axios, { type AxiosRequestConfig } from 'axios';
import {
  apiErrorMessage,
  isApiUnavailableError,
  resolveApiConfig,
  toApiError,
} from './api-runtime.js';
import { resolveVerificationError } from './verification.js';
import { resolveStellarNetwork } from '@shared/network';
import { createBrowserRequestId } from './request-correlation-id.ts';
import { useWalletStore } from './store';
import { createSellerSessionManager, type SellerSessionContext } from './wallet-session';
import { signSellerChallenge } from '@/lib/stellar';

/**
 * The API origin, resolved once per build.
 *
 * resolveApiConfig keeps the localhost default for development and refuses
 * a production deployment that forgot NEXT_PUBLIC_API_URL, so a misconfigured
 * build says so in the banner instead of quietly sending requests to the
 * developer's laptop.
 */
export const API_CONFIG = resolveApiConfig(
  process.env.NEXT_PUBLIC_API_URL,
  process.env.NODE_ENV
);

/**
 * Polling fallback for the pay page, used only when the API did not send its
 * own statusPollingIntervalMs. Matches the backend's interval.
 */
export const PAYMENT_STATUS_POLL_INTERVAL_MS = 3000;

const api = axios.create({
  baseURL: API_CONFIG.baseUrl,
  timeout: 12000,
  headers: {
    'Content-Type': 'application/json',
  },
});

type SellerRequestConfig = AxiosRequestConfig & {
  __sellerPublicKey?: string;
  __sellerContext?: SellerSessionContext;
  __sellerToken?: string;
  __sellerRetry?: boolean;
  __sellerCleanup?: () => void;
};

const activeSellerRequests = new Map<AbortController, SellerSessionContext>();

export const sellerSessionManager = createSellerSessionManager({
  getWalletSession: useWalletStore.getState,
  expectedNetwork: resolveStellarNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK),
  authenticate: async (wallet, assertCurrent) => {
    const challenge = await api.get('/auth/challenge', {
      params: { account: wallet.publicKey, network: wallet.network },
    });
    assertCurrent();
    const transaction = await signSellerChallenge(challenge.data.data, wallet.publicKey!);
    assertCurrent();
    const response = await api.post('/auth/session', { transaction, network: wallet.network });
    assertCurrent();
    return response.data.data;
  },
});

// Zustand subscriptions run in the store update, before the next React effect
// or seller fetch. Tokens and pending issuance are invalidated synchronously.
sellerSessionManager.sync();
useWalletStore.subscribe(() => {
  sellerSessionManager.sync();
  for (const [controller, context] of activeSellerRequests) {
    if (!sellerSessionManager.isCurrent(context)) {
      controller.abort();
      activeSellerRequests.delete(controller);
    }
  }
});

const forSeller = (sellerPublicKey?: string | null): SellerRequestConfig => ({
  // An absent key must still authenticate against the current wallet for create.
  __sellerPublicKey: sellerPublicKey || '',
});

api.interceptors.request.use(async (config) => {
  const request = config as typeof config & SellerRequestConfig;
  if (request.__sellerPublicKey !== undefined) {
    const context = request.__sellerContext ?? sellerSessionManager.contextFor(request.__sellerPublicKey);
    sellerSessionManager.assertCurrent(context);
    const token = await sellerSessionManager.getToken(context);
    sellerSessionManager.assertCurrent(context);
    request.__sellerContext = context;
    request.__sellerToken = token;
    config.headers.Authorization = `Bearer ${token}`;
    const controller = new AbortController();
    const originalSignal = config.signal;
    const abort = () => controller.abort();
    if (originalSignal?.aborted) controller.abort();
    originalSignal?.addEventListener?.('abort', abort);
    activeSellerRequests.set(controller, context);
    config.signal = controller.signal;
    request.__sellerCleanup = () => {
      activeSellerRequests.delete(controller);
      originalSignal?.removeEventListener?.('abort', abort);
    };
  }
  const headers = config.headers ?? {};
  const existing =
    headers['X-Request-Id'] ||
    headers['x-request-id'] ||
    headers['X-Correlation-Id'] ||
    headers['x-correlation-id'];
  if (!existing) {
    const id = createBrowserRequestId();
    headers['X-Request-Id'] = id;
    headers['X-Correlation-Id'] = id;
  }
  config.headers = headers;
  return config;
});

api.interceptors.response.use(
  (response) => {
    const request = response.config as SellerRequestConfig;
    request.__sellerCleanup?.();
    const context = request.__sellerContext;
    if (context) sellerSessionManager.assertCurrent(context);
    return response;
  },
  async (error) => {
    let failure = error;
    try {
      const request = error?.config as SellerRequestConfig | undefined;
      request?.__sellerCleanup?.();
      if (request?.__sellerContext) {
        sellerSessionManager.assertCurrent(request.__sellerContext);
        if (error?.response?.status === 401) {
          sellerSessionManager.invalidate(request.__sellerContext, request.__sellerToken || '');
          if (!request.__sellerRetry) {
            // Reuses the original wallet epoch. A switch never retries an old
            // seller's request using the new account's token.
            return await api.request({ ...request, __sellerRetry: true } as SellerRequestConfig);
          }
        }
      }
    } catch (retryError) {
      failure = retryError;
    }
    const normalized = toApiError(failure);
    console.error('API Error:', normalized.code, normalized.message);
    return Promise.reject(normalized);
  }
);

export const invoiceApi = {
  create: async (data: {
    amount: number;
    assetCode?: string;
    assetIssuer?: string;
    description?: string;
    customerName?: string;
    customerEmail?: string;
    expiresInDays: number;
    sellerPublicKey?: string;
    sellerName?: string;
    sellerEmail?: string;
    network?: string;
    idempotencyKey?: string;
  }) => {
    const normalizedAssetCode = data.assetCode ? data.assetCode.toUpperCase() : 'XLM';
    const response = await api.post('/invoices', {
      ...data,
      assetCode: normalizedAssetCode,
    }, forSeller(data.sellerPublicKey));
    return response.data;
  },

  getById: async (id: string, sellerPublicKey?: string | null) => {
    // The public pay page never signs in. A workspace caller earns a session;
    // the key is an ownership assertion, not a credential.
    const response = await api.get(`/invoices/${id}`, {
      params: sellerPublicKey ? { sellerPublicKey } : undefined,
      ...(sellerPublicKey ? forSeller(sellerPublicKey) : {}),
    });
    return response.data;
  },

  // Invoice history is scoped to the connected Freighter wallet, so the seller
  // key is required for list and stats calls.
  getAll: async (params: {
    sellerPublicKey: string;
    status?: string;
    limit?: number;
    offset?: number;
    q?: string;
  }) => {
    const response = await api.get('/invoices', { params, ...forSeller(params.sellerPublicKey) });
    return response.data;
  },

  getPaymentInfo: async (id: string) => {
    const response = await api.get(`/invoices/${id}/payment-info`);
    return response.data;
  },

  // Seller-only audit feed (issue #515): rejected verifies and monitor
  // rejections for this invoice. Requires the invoice's own seller key.
  getPaymentEvents: async (id: string, sellerPublicKey: string) => {
    const response = await api.get(`/invoices/${id}/events`, {
      params: { sellerPublicKey },
      ...forSeller(sellerPublicKey),
    });
    return response.data;
  },

  // Cancellation uses the same expiring, network-bound seller session.
  cancel: async (id: string, sellerPublicKey: string) => {
    const response = await api.post(`/invoices/${id}/cancel`, { sellerPublicKey }, forSeller(sellerPublicKey));
    return response.data;
  },

  verify: async (id: string, txHash: string, payerInfo?: { payerName?: string; payerEmail?: string }) => {
    const response = await api.post(`/invoices/${id}/verify`, {
      txHash,
      // Lets the server reject a payment submitted from the wrong wallet network.
      // Resolved through the shared contract so the client sends the canonical
      // 'TESTNET' | 'PUBLIC' name rather than a raw env string (issue #511).
      network: resolveStellarNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK),
      ...payerInfo
    });
    return response.data;
  },

  getStats: async (sellerPublicKey: string) => {
    const response = await api.get('/invoices/stats', {
      params: { sellerPublicKey },
      ...forSeller(sellerPublicKey),
    });
    return response.data;
  },
};

// Stellar APIs
export const stellarApi = {
  getAccount: async (publicKey?: string) => {
    const response = await api.get('/stellar/account', {
      params: { publicKey },
    });
    return response.data;
  },

  getPayments: async (publicKey?: string, limit?: number) => {
    const response = await api.get('/stellar/payments', {
      params: { publicKey, limit },
    });
    return response.data;
  },

  getTransaction: async (hash: string) => {
    const response = await api.get(`/stellar/transaction/${hash}`);
    return response.data;
  },

  verifyPayment: async (txHash: string, memo: string, amount: string) => {
    const response = await api.post('/stellar/verify-payment', {
      txHash,
      memo,
      amount,
    });
    return response.data;
  },
};

// Health check
export const healthCheck = async () => {
  const response = await api.get('/health');
  return response.data;
};

export { apiErrorMessage, isApiUnavailableError, resolveVerificationError };

export default api;
