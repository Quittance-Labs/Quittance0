import axios from 'axios';
import { mockInvoiceApi, mockStellarApi, mockHealthCheck } from './mock-api';
import {
  type ApiResponse,
  type Invoice,
  type InvoiceStats,
  type PaymentSession,
  type CreateInvoiceInput,
  type StellarAccount,
  type StellarPayments,
  type StellarTransaction,
  type StellarPaymentVerification,
  type VerifyStellarPaymentInput,
} from './utils';

const USE_MOCK_API = process.env.NEXT_PUBLIC_USE_MOCK === 'true';
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message);
    return Promise.reject(error);
  }
);

/**
 * Typed shape for every Quittance0 invoice endpoint.
 * Real (`api`-backed) implementation below; mock implementation imported
 * alongside and re-cast to this shape at the export boundary so the
 * conditional union collapses cleanly for downstream consumers.
 *
 * Returns an `ApiResponse<T>` envelope (mirrors the shape produced by
 * `backend/src/controllers/invoice.controller.ts`:
 *   `{ success: true, data: T, pagination?: {...} }` on success and
 *   `{ success: false, error: string }` on error). Consumers access
 *   `.data` to retrieve the typed payload — e.g. `result.data` is
 *   `Invoice`, `PaymentSession`, `Invoice[]`, or `InvoiceStats[]`
 *   depending on the endpoint.
 *
 * The mock branch is intentionally re-cast to `typeof realInvoiceApi`
 * because `mockInvoiceApi` from `./mock-api` is a loosely-typed module
 * (its `mockInvoices` list is an inferred array whose element shapes
 * don't satisfy the discriminated `Invoice` union). The cast is at the
 * api/mock boundary only — nothing on consumer sites — and the mock
 * shape is, at runtime, structurally compatible with the typed shape
 * (same field names; status is a literal in both). Re-typing
 * `mock-api.ts` is a separate followup (out of scope for this PR).
 */
const realInvoiceApi = {
  create: async (data: CreateInvoiceInput): Promise<ApiResponse<PaymentSession>> => {
    const response = await api.post<ApiResponse<PaymentSession>>('/invoices', data);
    return response.data;
  },

  getById: async (id: string): Promise<ApiResponse<Invoice>> => {
    const response = await api.get<ApiResponse<Invoice>>(`/invoices/${id}`);
    return response.data;
  },

  getAll: async (params?: {
    status?: string;
    limit?: number;
    offset?: number;
    sellerPublicKey?: string;
  }): Promise<ApiResponse<Invoice[]>> => {
    const response = await api.get<ApiResponse<Invoice[]>>('/invoices', { params });
    return response.data;
  },

  getPaymentInfo: async (id: string): Promise<ApiResponse<PaymentSession>> => {
    const response = await api.get<ApiResponse<PaymentSession>>(`/invoices/${id}/payment-info`);
    return response.data;
  },

  cancel: async (id: string): Promise<ApiResponse<Invoice>> => {
    const response = await api.post<ApiResponse<Invoice>>(`/invoices/${id}/cancel`);
    return response.data;
  },

  verify: async (id: string, txHash: string, payerInfo?: { payerPublicKey?: string; payerName?: string; payerEmail?: string }): Promise<ApiResponse<Invoice>> => {
    const response = await api.post<ApiResponse<Invoice>>(`/invoices/${id}/verify`, {
      txHash,
      ...payerInfo,
    });
    return response.data;
  },

  getStats: async (sellerPublicKey?: string): Promise<ApiResponse<InvoiceStats[]>> => {
    const response = await api.get<ApiResponse<InvoiceStats[]>>('/invoices/stats', {
      params: sellerPublicKey ? { sellerPublicKey } : undefined,
    });
    return response.data;
  },
};

export const invoiceApi: typeof realInvoiceApi = USE_MOCK_API
  ? (mockInvoiceApi as typeof realInvoiceApi)
  : realInvoiceApi;

// Stellar APIs
// Typed to `Promise<ApiResponse<T>>` envelope — mirror of the `invoiceApi`
// typed pattern from commit `8e1a1f7`. The api↔mock boundary cast below
// (`mockStellarApi as typeof realStellarApi`) suppresses the mock's
// structural narrowness on `getTransaction` (`transaction: { hash,
// memo, successful }` vs. the typed shape with `[k: string]: unknown`);
// runtime compatibility is direct because the mock fields are a subset
// of what the backend service serializes. See `frontend/lib/utils.ts`
// for the `StellarAccount | StellarPayments | StellarTransaction |
// StellarPaymentVerification` envelope definitions.
//
// Note: zero `stellarApi.*` consumer sites exist in `frontend/` today
// (verified via code-search). Re-typing the block here is purely
// defensive — locks the typed contract end-to-end so any future
// consumer reads/writes with `tsc` enforcement, parallel to the
// `invoiceApi` typed pattern.
const realStellarApi = {
  getAccount: async (publicKey?: string): Promise<ApiResponse<StellarAccount>> => {
    const response = await api.get<ApiResponse<StellarAccount>>('/stellar/account', {
      params: { publicKey },
    });
    return response.data;
  },

  getPayments: async (publicKey?: string, limit?: number): Promise<ApiResponse<StellarPayments>> => {
    const response = await api.get<ApiResponse<StellarPayments>>('/stellar/payments', {
      params: { publicKey, limit },
    });
    return response.data;
  },

  getTransaction: async (hash: string): Promise<ApiResponse<StellarTransaction>> => {
    const response = await api.get<ApiResponse<StellarTransaction>>(`/stellar/transaction/${hash}`);
    return response.data;
  },

  verifyPayment: async (input: VerifyStellarPaymentInput): Promise<ApiResponse<StellarPaymentVerification>> => {
    const response = await api.post<ApiResponse<StellarPaymentVerification>>('/stellar/verify-payment', input);
    return response.data;
  },
};

export const stellarApi: typeof realStellarApi = USE_MOCK_API
  ? (mockStellarApi as typeof realStellarApi)
  : realStellarApi;

// Health check
export const healthCheck = USE_MOCK_API ? mockHealthCheck : async () => {
  const response = await api.get('/health');
  return response.data;
};

export default api;
