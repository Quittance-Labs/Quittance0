import axios from 'axios';
import { mockInvoiceApi, mockStellarApi, mockHealthCheck } from './mock-api';
import {
  ApiUnavailableError,
  apiErrorMessage,
  isApiUnavailableError,
  resolveApiConfig,
  toApiError,
} from './api-runtime';

const USE_MOCK_API = process.env.NEXT_PUBLIC_USE_MOCK === 'true';
export const API_CONFIG = resolveApiConfig(
  process.env.NEXT_PUBLIC_API_URL,
  process.env.NODE_ENV
);
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

/**
 * Turns a failed request into an English sentence for a live region.
 *
 * A failed load used to reach the user only as a toast, which disappears, and
 * as a console entry, which does not reach them at all — so a page that failed
 * to load simply stayed blank for a screen-reader user (issue #289). The status
 * regions on the pages read this instead.
 *
 * The backend's own wording is preferred because it is the most specific thing
 * available; this mirrors `describeVerifyError` in `payment-page-state.js`,
 * which does the same for the verify endpoint.
 */
export function describeApiError(error: any, fallback = 'Something went wrong.'): string {
  const serverMessage = error?.response?.data?.error;
  if (typeof serverMessage === 'string' && serverMessage.trim()) {
    return serverMessage;
  }

  if (error?.response?.status === 404) {
    return 'Not found.';
  }

  const transportMessage = error?.message;
  if (typeof transportMessage === 'string' && transportMessage.trim()) {
    return transportMessage;
  }

  return fallback;
}
export const invoiceApi = USE_MOCK_API ? mockInvoiceApi : {
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
  }) => {
    const response = await api.post('/invoices', data);
    return response.data;
  },

  getById: async (id: string) => {
    const response = await api.get(`/invoices/${id}`);
    return response.data;
  },

  // Invoice history is scoped to the connected Freighter wallet, so the seller
  // key is required for list and stats calls.
  getAll: async (params: {
    sellerPublicKey: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const response = await api.get('/invoices', { params });
    return response.data;
  },

  getPaymentInfo: async (id: string) => {
    const response = await api.get(`/invoices/${id}/payment-info`);
    return response.data;
  },

  cancel: async (id: string) => {
    const response = await api.post(`/invoices/${id}/cancel`);
    return response.data;
  },

  verify: async (id: string, txHash: string, payerInfo?: { payerName?: string; payerEmail?: string }) => {
    const response = await api.post(`/invoices/${id}/verify`, {
      txHash,
      // Lets the server reject a payment made on a different Stellar network.
      network: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
      ...payerInfo
    });
    return response.data;
  },

  getStats: async (sellerPublicKey: string) => {
    const response = await api.get('/invoices/stats', {
      params: { sellerPublicKey },
    });
    return response.data;
  },
};

// Stellar APIs
export const stellarApi = USE_MOCK_API ? mockStellarApi : {
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
export const healthCheck = USE_MOCK_API ? mockHealthCheck : async () => {
  if (!API_CONFIG.configured) {
    throw new ApiUnavailableError(API_CONFIG.error || undefined);
  }
  const response = await api.get('/health');
  return response.data;
};

export { apiErrorMessage, isApiUnavailableError };

export default api;
