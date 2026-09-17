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
    const normalized = toApiError(error);
    console.error('API Error:', normalized.code, normalized.message);
    return Promise.reject(normalized);
  }
);

import type {
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
import {
  parseCancelInvoiceResponse,
  parseCreateInvoiceResponse,
  parseGetInvoiceResponse,
  parseGetStatsResponse,
  parseListInvoicesResponse,
  parsePaymentInfoResponse,
  parseVerifyPaymentResponse,
} from '../../shared/invoice-contract';

export const invoiceApi = {
  create: async (data: CreateInvoiceRequest): Promise<CreateInvoiceResponse> => {
    const normalizedAssetCode = data.assetCode ? data.assetCode.toUpperCase() : 'XLM';
    const response = await api.post('/invoices', {
      ...data,
      assetCode: normalizedAssetCode,
    });
    const parsed = parseCreateInvoiceResponse(response.data);
    if (!parsed.success) {
      throw new Error(`Create invoice contract parse failure: ${parsed.error}`);
    }
    return parsed.data;
  },

  getById: async (id: string): Promise<GetInvoiceResponse> => {
    const response = await api.get(`/invoices/${id}`);
    const parsed = parseGetInvoiceResponse(response.data);
    if (!parsed.success) {
      throw new Error(`Get invoice contract parse failure: ${parsed.error}`);
    }
    return parsed.data;
  },

  getAll: async (params: ListInvoicesQuery): Promise<ListInvoicesResponse> => {
    const response = await api.get('/invoices', { params });
    const parsed = parseListInvoicesResponse(response.data);
    if (!parsed.success) {
      throw new Error(`List invoices contract parse failure: ${parsed.error}`);
    }
    return parsed.data;
  },

  getPaymentInfo: async (id: string): Promise<PaymentInfoResponse> => {
    const response = await api.get(`/invoices/${id}/payment-info`);
    const parsed = parsePaymentInfoResponse(response.data);
    if (!parsed.success) {
      throw new Error(`Payment info contract parse failure: ${parsed.error}`);
    }
    return parsed.data;
  },

  cancel: async (id: string, sellerPublicKey?: string): Promise<CancelInvoiceResponse> => {
    const response = await api.post(`/invoices/${id}/cancel`, { sellerPublicKey });
    const parsed = parseCancelInvoiceResponse(response.data);
    if (!parsed.success) {
      throw new Error(`Cancel invoice contract parse failure: ${parsed.error}`);
    }
    return parsed.data;
  },

  verify: async (
    id: string,
    txHash: string,
    payerInfo?: { payerName?: string; payerEmail?: string }
  ): Promise<VerifyPaymentResponse> => {
    const response = await api.post(`/invoices/${id}/verify`, {
      txHash,
      network: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
      ...payerInfo,
    });
    const parsed = parseVerifyPaymentResponse(response.data);
    if (!parsed.success) {
      throw new Error(`Verify payment contract parse failure: ${parsed.error}`);
    }
    return parsed.data;
  },

  getStats: async (sellerPublicKey: string): Promise<GetStatsResponse> => {
    const response = await api.get('/invoices/stats', {
      params: { sellerPublicKey },
    });
    const parsed = parseGetStatsResponse(response.data);
    if (!parsed.success) {
      throw new Error(`Get stats contract parse failure: ${parsed.error}`);
    }
    return parsed.data;
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
