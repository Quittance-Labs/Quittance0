import axios from 'axios';
import {
  apiErrorMessage,
  isApiUnavailableError,
  resolveApiConfig,
  toApiError,
} from './api-runtime.js';
import { resolveVerificationError } from './verification.js';
import { resolveStellarNetwork } from '@shared/network';
import { createBrowserRequestId } from './request-correlation-id.ts';

import type {
  ApiSuccess,
  InvoiceStatsDto,
  CancelInvoiceResponse,
  CreateInvoiceRequest,
  CreateInvoiceResponse,
  GetInvoiceResponse,
  GetStatsResponse,
  ListInvoicesQuery,
  ListInvoicesResponse,
  PaymentInfoResponse,
  VerifyPaymentResponse,
} from '../../shared/invoice-contract';

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

api.interceptors.request.use((config) => {
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
  (response) => response,
  (error) => {
    const normalized = toApiError(error);
    console.error('API Error:', normalized.code, normalized.message);
    return Promise.reject(normalized);
  }
);

// Keep shared response types without making schema drift a runtime page gate.
// Contract tests validate the strict parsers; rolling client/server versions may
// omit optional fields or add new ones. Transport and server failures still
// reject through the interceptor above; request validation is unchanged.
export const invoiceApi = {
  create: async (data: CreateInvoiceRequest): Promise<CreateInvoiceResponse> => {
    const normalizedAssetCode = data.assetCode ? data.assetCode.toUpperCase() : 'XLM';
    const response = await api.post<CreateInvoiceResponse>('/invoices', {
      ...data,
      assetCode: normalizedAssetCode,
    });
    return response.data;
  },
  getById: async (
    id: string,
    sellerPublicKey?: string | null
  ): Promise<GetInvoiceResponse> => {
    // Workspace fields (client contact, payer identity) are only returned when
    // the caller presents the invoice's own seller key — issue #503. The pay
    // page calls this without a key and receives the public pay DTO.
    const response = await api.get<GetInvoiceResponse>(`/invoices/${id}`, {
      params: sellerPublicKey ? { sellerPublicKey } : undefined,
    });
    return response.data;
  },
  // Invoice history is scoped to the connected Freighter wallet, so the seller
  // key is required for list and stats calls.
  getAll: async (params: ListInvoicesQuery): Promise<ListInvoicesResponse> => {
    const response = await api.get<ListInvoicesResponse>('/invoices', { params });
    return response.data;
  },
  getPaymentInfo: async (id: string): Promise<PaymentInfoResponse> => {
    const response = await api.get<PaymentInfoResponse>(`/invoices/${id}/payment-info`);
    return response.data;
  },
  // Seller-only audit feed (issue #515): rejected verifies and monitor
  // rejections for this invoice. Requires the invoice's own seller key.
  getPaymentEvents: async (id: string, sellerPublicKey: string) => {
    const response = await api.get(`/invoices/${id}/events`, {
      params: { sellerPublicKey },
    });
    return response.data;
  },

  // One proof path (issue #517): the seller key and the Freighter signature
  // over `cancel:<id>` travel in the request body — never in query or header.
  cancel: async (
    id: string,
    sellerPublicKey: string,
    signature?: string
  ): Promise<CancelInvoiceResponse> => {
    const response = await api.post<CancelInvoiceResponse>(`/invoices/${id}/cancel`, {
      sellerPublicKey,
      signature,
    });
    return response.data;
  },
  verify: async (
    id: string,
    txHash: string,
    payerInfo?: { payerName?: string; payerEmail?: string }
  ): Promise<VerifyPaymentResponse> => {
    const response = await api.post<VerifyPaymentResponse>(`/invoices/${id}/verify`, {
      txHash,
      // Lets the server reject a payment submitted from the wrong wallet network.
      // Resolved through the shared contract so the client sends the canonical
      // 'TESTNET' | 'PUBLIC' name rather than a raw env string (issue #511).
      network: resolveStellarNetwork(process.env.NEXT_PUBLIC_STELLAR_NETWORK),
      ...payerInfo,
    });
    return response.data;
  },
  getStats: async (sellerPublicKey: string): Promise<GetStatsResponse> => {
    const response = await api.get<GetStatsResponse | ApiSuccess<InvoiceStatsDto[]>>('/invoices/stats', {
      params: { sellerPublicKey },
    });
    // Storage currently wraps stats in a one-row array. Keep the client's
    // object shape without rejecting older partial responses or losing fields.
    const body = response.data;
    return Array.isArray(body.data) ? { ...body, data: body.data[0] } : body as GetStatsResponse;
  }
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
