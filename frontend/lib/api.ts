import axios from 'axios';
import {
  apiErrorMessage,
  isApiUnavailableError,
  resolveApiConfig,
  toApiError,
} from './api-runtime.js';
import { resolveVerificationError } from './verification.js';
import { resolveStellarNetwork } from '@shared/network';
import { SELLER_READ_MAX_AGE_MS } from '@shared/seller-read-proof';
import { assertFreighterReady, signSellerReadMessage } from './stellar';

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

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const normalized = toApiError(error);
    console.error('API Error:', normalized.code, normalized.message);
    return Promise.reject(normalized);
  }
);

type SellerReadProof = { publicKey: string; signedAt: string; signature: string };
const sellerReadProofs = new Map<string, SellerReadProof>();
const pendingSellerReadProofs = new Map<string, Promise<SellerReadProof>>();

/** A proof is short-lived, scoped to one route, and never put in a URL. */
async function sellerReadHeaders(scope: string, sellerPublicKey: string) {
  const session = await assertFreighterReady();
  if (session.publicKey !== sellerPublicKey) {
    throw new Error('Connect the invoice seller wallet to view workspace details');
  }
  const cacheKey = `${scope}:${sellerPublicKey}`;
  const cached = sellerReadProofs.get(cacheKey);
  if (cached && Date.now() - Number(cached.signedAt) < SELLER_READ_MAX_AGE_MS - 15_000) {
    return {
      'X-Seller-Signed-At': cached.signedAt,
      'X-Seller-Signature': cached.signature,
    };
  }
  let pending = pendingSellerReadProofs.get(cacheKey);
  if (!pending) {
    pending = signSellerReadMessage(scope, sellerPublicKey);
    pendingSellerReadProofs.set(cacheKey, pending);
  }
  try {
    const proof = await pending;
    sellerReadProofs.set(cacheKey, proof);
    return {
      'X-Seller-Signed-At': proof.signedAt,
      'X-Seller-Signature': proof.signature,
    };
  } finally {
    if (pendingSellerReadProofs.get(cacheKey) === pending) {
      pendingSellerReadProofs.delete(cacheKey);
    }
  }
}

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
    });
    return response.data;
  },

  getById: async (id: string, sellerPublicKey?: string | null) => {
    // The pay page calls this without seller proof and receives the public DTO.
    const headers = sellerPublicKey
      ? await sellerReadHeaders(`invoice:${id}`, sellerPublicKey)
      : undefined;
    const response = await api.get(`/invoices/${id}`, {
      params: sellerPublicKey ? { sellerPublicKey } : undefined,
      headers,
    });
    return response.data;
  },

  // Invoice history requires signed proof from the connected seller wallet.
  getAll: async (params: {
    sellerPublicKey: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const headers = await sellerReadHeaders('invoices', params.sellerPublicKey);
    const response = await api.get('/invoices', { params, headers });
    return response.data;
  },

  getPaymentInfo: async (id: string) => {
    const response = await api.get(`/invoices/${id}/payment-info`);
    return response.data;
  },

  // Seller-only audit feed (issue #515) requires the invoice wallet's proof.
  getPaymentEvents: async (id: string, sellerPublicKey: string) => {
    const headers = await sellerReadHeaders(`events:${id}`, sellerPublicKey);
    const response = await api.get(`/invoices/${id}/events`, {
      params: { sellerPublicKey },
      headers,
    });
    return response.data;
  },

  // One proof path (issue #517): the seller key and the Freighter signature
  // over `cancel:<id>` travel in the request body — never in query or header.
  cancel: async (id: string, sellerPublicKey: string, signature?: string) => {
    const response = await api.post(`/invoices/${id}/cancel`, { sellerPublicKey, signature });
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
    const headers = await sellerReadHeaders('stats', sellerPublicKey);
    const response = await api.get('/invoices/stats', {
      params: { sellerPublicKey },
      headers,
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
