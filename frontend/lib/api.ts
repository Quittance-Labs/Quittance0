import axios from 'axios';
import {
  apiErrorMessage,
  isApiUnavailableError,
  resolveApiConfig,
  toApiError,
} from './api-runtime.js';
import { resolveVerificationError } from './verification.js';

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
    if (
      axios.isCancel?.(error) ||
      error?.name === 'CanceledError' ||
      error?.code === 'ERR_CANCELED' ||
      error?.name === 'AbortError'
    ) {
      return Promise.reject(error);
    }
    const normalized = toApiError(error);
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
  }) => {
    const normalizedAssetCode = data.assetCode ? data.assetCode.toUpperCase() : 'XLM';
    const response = await api.post('/invoices', {
      ...data,
      assetCode: normalizedAssetCode,
    });
    return response.data;
  },

  getById: async (id: string, options?: { signal?: AbortSignal }) => {
    const response = await api.get(`/invoices/${id}`, { signal: options?.signal });
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

  getPaymentInfo: async (id: string, options?: { signal?: AbortSignal }) => {
    const response = await api.get(`/invoices/${id}/payment-info`, { signal: options?.signal });
    return response.data;
  },

  cancel: async (id: string, sellerPublicKey?: string) => {
    const response = await api.post(`/invoices/${id}/cancel`, { sellerPublicKey });
    return response.data;
  },

  verify: async (
    id: string,
    txHash: string,
    payerInfo?: { payerName?: string; payerEmail?: string },
    options?: { signal?: AbortSignal }
  ) => {
    const response = await api.post(
      `/invoices/${id}/verify`,
      {
        txHash,
        // Lets the server reject a payment submitted from the wrong wallet network.
        network: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
        ...payerInfo,
      },
      { signal: options?.signal }
    );
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
