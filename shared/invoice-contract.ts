/**
 * Unified invoice API contract shared by Express handlers and the Next.js client.
 *
 * Request/response shapes, the shared error envelope, runtime parsers, and an
 * OpenAPI 3.0.3 document for create / get / list / cancel / verify / stats.
 * Parsers fail when a required field is missing so FE and BE cannot drift.
 */

import type {
  InvoiceDto,
  InvoiceStatus,
  IsoTimestamp,
  LatePaymentWarningCode,
  SettlementContext,
} from './invoice';
import {
  collectCreateInvoiceFieldErrors,
  firstCreateInvoiceMessage,
} from './invoice-validation';
import type { VerificationCode, VerificationFailureBody } from './verification';

export type {
  InvoiceDto,
  InvoiceStatus,
  IsoTimestamp,
  LatePaymentWarningCode,
  SettlementContext,
  VerificationCode,
  VerificationFailureBody,
};

/** Standard success envelope for resource responses. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  message?: string;
  code?: string;
  warning?: string;
  pagination?: ApiPagination;
}

/** Pagination metadata for collection responses. */
export interface ApiPagination {
  limit: number;
  offset: number;
  total: number;
}

/** Standard success envelope for paginated collection responses. */
export interface ApiPaginatedSuccess<T> {
  success: true;
  data: T[];
  pagination: ApiPagination;
}

/** Standard error envelope returned on API request failures. */
export interface ApiFailure {
  success: false;
  error: string;
  code?: string;
  field?: string;
  fieldErrors?: Record<string, string>;
}

/** Structured validation failure envelope naming field-level mistakes. */
export interface ValidationFailureBody {
  success: false;
  code: 'VALIDATION_ERROR';
  error: string;
  fieldErrors: Record<string, string>;
  field?: string;
}

/** Request payload for creating a new invoice. */
export interface CreateInvoiceRequest {
  amount: number;
  assetCode?: string;
  assetIssuer?: string;
  description?: string;
  customerName?: string;
  customerEmail?: string;
  sellerPublicKey?: string;
  sellerName?: string;
  sellerEmail?: string;
  expiresInDays?: number;
  network?: 'TESTNET' | 'PUBLIC' | string;
  idempotencyKey?: string;
}

/** Payload returned within the success envelope after creating an invoice. */
export interface CreateInvoiceResult {
  invoice: InvoiceDto;
  paymentAvailable: boolean;
  paymentUrl: string;
  statusPollingIntervalMs?: number;
  qrCode?: string | null;
  stellarQrCode?: string | null;
  stellarUri?: string | null;
  stellarQrEncodesUri?: boolean;
  copyValue?: string | null;
  networkPassphrase?: string | null;
}

/** Complete response envelope for invoice creation. */
export type CreateInvoiceResponse = ApiSuccess<CreateInvoiceResult>;

/** Route parameters for retrieving a single invoice. */
export interface GetInvoiceParams {
  id: string;
}

/** Complete response envelope for retrieving an invoice. */
export type GetInvoiceResponse = ApiSuccess<InvoiceDto>;

/** Query parameters for listing seller invoices. */
export interface ListInvoicesQuery {
  sellerPublicKey: string;
  /** Search term supported by the current seller dashboard. */
  q?: string;
  status?: InvoiceStatus | string;
  limit?: number;
  offset?: number;
}

/** Complete response envelope for listing invoices. */
export type ListInvoicesResponse = ApiPaginatedSuccess<InvoiceDto>;

/** Payload returned within the success envelope for invoice payment instructions. */
export interface PaymentInfoResult {
  invoice?: InvoiceDto;
  paymentAvailable?: boolean;
  paymentUrl?: string;
  statusPollingIntervalMs?: number;
  qrCode?: string | null;
  stellarQrCode?: string | null;
  stellarUri?: string | null;
  stellarQrEncodesUri?: boolean;
  copyValue?: string | null;
  networkPassphrase?: string | null;
}

/** Complete response envelope for invoice payment instructions. */
export type PaymentInfoResponse = ApiSuccess<PaymentInfoResult>;

/** Request payload for cancelling an invoice. */
export interface CancelInvoiceRequest {
  sellerPublicKey?: string;
  signature?: string;
  message?: string;
}

/** Complete response envelope for invoice cancellation. */
export type CancelInvoiceResponse = ApiSuccess<InvoiceDto>;

/** Request payload for verifying a submitted payment transaction. */
export interface VerifyPaymentRequest {
  txHash: string;
  payerName?: string;
  payerEmail?: string;
  network?: string;
}

/** Complete response envelope for payment verification. */
export interface VerifyPaymentResponse {
  success: true;
  data: InvoiceDto;
  message?: string;
  code?: string;
  warning?: string;
}

/** Aggregate metrics and statistics for seller invoices. */
export interface InvoiceStatsDto {
  total_invoices: number;
  paid_invoices: number;
  pending_invoices: number;
  actionable_invoices: number;
  expired_invoices: number;
  revenue_by_asset: Record<string, number>;
}

/** Query parameters for invoice statistics. */
export interface GetStatsQuery {
  sellerPublicKey: string;
}

/** Complete response envelope for invoice statistics. */
export type GetStatsResponse = ApiSuccess<InvoiceStatsDto>;

/** Result returned by contract parsers. */
export type ContractResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: string;
      code?: string;
      fieldErrors?: Record<string, string>;
    };

/** Required InvoiceDto keys — contract tests fail if this list loses a field. */
export const REQUIRED_INVOICE_DTO_FIELDS = [
  'id',
  'sellerPublicKey',
  'amount',
  'assetCode',
  'memo',
  'status',
  'createdAt',
  'expiresAt',
] as const;

const VALID_INVOICE_STATUSES: readonly string[] = [
  'PENDING',
  'PAID',
  'EXPIRED',
  'CANCELLED',
];

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

/** Legacy payloads may omit success; a supplied discriminant must be true. */
function isSuccessfulResponse(input: unknown): input is Record<string, unknown> {
  return isObject(input) && (!('success' in input) || input.success === true);
}

/**
 * Validates whether an unknown value conforms to the InvoiceDto contract.
 */
export function parseInvoiceDto(input: unknown): ContractResult<InvoiceDto> {
  if (!isObject(input)) {
    return { success: false, error: 'Invoice must be an object' };
  }

  const { id, sellerPublicKey, amount, assetCode, memo, status, createdAt, expiresAt } =
    input;

  if (typeof id !== 'string' || id.trim() === '') {
    return { success: false, error: 'Invoice id is required and must be a string' };
  }
  if (typeof sellerPublicKey !== 'string' || sellerPublicKey.trim() === '') {
    return {
      success: false,
      error: 'Invoice sellerPublicKey is required and must be a string',
    };
  }
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return {
      success: false,
      error: 'Invoice amount must be a positive finite number',
    };
  }
  if (typeof assetCode !== 'string' || assetCode.trim() === '') {
    return {
      success: false,
      error: 'Invoice assetCode is required and must be a string',
    };
  }
  if (typeof memo !== 'string' || memo.trim() === '') {
    return { success: false, error: 'Invoice memo is required and must be a string' };
  }
  if (typeof status !== 'string' || !VALID_INVOICE_STATUSES.includes(status)) {
    return {
      success: false,
      error: 'Invoice status must be PENDING, PAID, EXPIRED, or CANCELLED',
    };
  }
  if (typeof createdAt !== 'string' || createdAt.trim() === '') {
    return {
      success: false,
      error: 'Invoice createdAt is required and must be a string',
    };
  }
  if (typeof expiresAt !== 'string' || expiresAt.trim() === '') {
    return {
      success: false,
      error: 'Invoice expiresAt is required and must be a string',
    };
  }

  return { success: true, data: input as unknown as InvoiceDto };
}

/**
 * Validates an invoice creation request payload against the shared domain rules.
 */
export function parseCreateInvoiceRequest(
  input: unknown
): ContractResult<CreateInvoiceRequest> {
  const errors = collectCreateInvoiceFieldErrors(input);
  if (Object.keys(errors).length > 0) {
    const primary = firstCreateInvoiceMessage(errors) || 'Validation failed';
    return {
      success: false,
      code: 'VALIDATION_ERROR',
      error: primary,
      fieldErrors: errors,
    };
  }

  return { success: true, data: input as CreateInvoiceRequest };
}

function unwrapDataObject(input: Record<string, unknown>): Record<string, unknown> {
  if ('data' in input && isObject(input.data)) {
    return input.data;
  }
  return input;
}

function unwrapInvoiceTarget(raw: Record<string, unknown>): Record<string, unknown> {
  if ('invoice' in raw && isObject(raw.invoice)) {
    return raw.invoice;
  }
  return raw;
}

/**
 * Validates that an API response adheres to the CreateInvoiceResponse contract.
 */
export function parseCreateInvoiceResponse(
  input: unknown
): ContractResult<CreateInvoiceResponse> {
  if (!isSuccessfulResponse(input)) {
    return { success: false, error: 'Create response must be an object' };
  }

  const raw = unwrapDataObject(input);
  const invoiceParsed = parseInvoiceDto(unwrapInvoiceTarget(raw));
  if (!invoiceParsed.success) {
    return invoiceParsed;
  }

  const paymentAvailable =
    typeof raw.paymentAvailable === 'boolean'
      ? raw.paymentAvailable
      : invoiceParsed.data.status === 'PENDING';
  const paymentUrl = typeof raw.paymentUrl === 'string' ? raw.paymentUrl : '';

  return {
    success: true,
    data: {
      success: true,
      data: {
        invoice: invoiceParsed.data,
        paymentAvailable,
        paymentUrl,
        statusPollingIntervalMs:
          typeof raw.statusPollingIntervalMs === 'number'
            ? raw.statusPollingIntervalMs
            : undefined,
        qrCode: typeof raw.qrCode === 'string' ? raw.qrCode : null,
        stellarQrCode: typeof raw.stellarQrCode === 'string' ? raw.stellarQrCode : null,
        stellarUri: typeof raw.stellarUri === 'string' ? raw.stellarUri : null,
        copyValue: typeof raw.copyValue === 'string' ? raw.copyValue : null,
        networkPassphrase:
          typeof raw.networkPassphrase === 'string' ? raw.networkPassphrase : null,
        stellarQrEncodesUri:
          typeof raw.stellarQrEncodesUri === 'boolean'
            ? raw.stellarQrEncodesUri
            : undefined,
      },
    },
  };
}

/**
 * Validates that an API response adheres to the GetInvoiceResponse contract.
 */
export function parseGetInvoiceResponse(
  input: unknown
): ContractResult<GetInvoiceResponse> {
  if (!isSuccessfulResponse(input)) {
    return { success: false, error: 'Get response must be an object' };
  }

  const invoiceParsed = parseInvoiceDto(unwrapInvoiceTarget(unwrapDataObject(input)));
  if (!invoiceParsed.success) {
    return invoiceParsed;
  }

  return {
    success: true,
    data: {
      success: true,
      data: invoiceParsed.data,
    },
  };
}

/**
 * Validates that an API response adheres to the ListInvoicesResponse contract.
 * Legacy responses may omit pagination. Supplied metadata must be complete
 * and valid rather than silently replacing malformed values with page totals.
 */
export function parseListInvoicesResponse(
  input: unknown
): ContractResult<ListInvoicesResponse> {
  if (Array.isArray(input)) {
    return parseListInvoicesResponse({ success: true, data: input });
  }
  if (!isSuccessfulResponse(input)) {
    return { success: false, error: 'List response must be an object' };
  }

  const list = Array.isArray(input.data) ? input.data : null;

  if (!list) {
    return { success: false, error: 'List response must contain an array in data' };
  }

  const invoices: InvoiceDto[] = [];
  for (const item of list) {
    const itemParsed = parseInvoiceDto(item);
    if (!itemParsed.success) {
      return itemParsed;
    }
    invoices.push(itemParsed.data);
  }

  let pagination: ApiPagination = {
    limit: invoices.length,
    offset: 0,
    total: invoices.length,
  };
  if (Object.prototype.hasOwnProperty.call(input, 'pagination')) {
    if (!isObject(input.pagination)) {
      return { success: false, error: 'List pagination must be an object' };
    }
    for (const field of ['limit', 'offset', 'total'] as const) {
      const value = input.pagination[field];
      if (
        !Object.prototype.hasOwnProperty.call(input.pagination, field) ||
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value < 0
      ) {
        return {
          success: false,
          error: `List pagination.${field} must be a non-negative safe integer`,
        };
      }
    }
    pagination = {
      limit: input.pagination.limit as number,
      offset: input.pagination.offset as number,
      total: input.pagination.total as number,
    };
  }

  return {
    success: true,
    data: {
      success: true,
      data: invoices,
      pagination,
    },
  };
}

/**
 * Validates that an API response adheres to the PaymentInfoResponse contract.
 */
export function parsePaymentInfoResponse(
  input: unknown
): ContractResult<PaymentInfoResponse> {
  if (!isSuccessfulResponse(input)) {
    return { success: false, error: 'Payment info response must be an object' };
  }

  const raw = unwrapDataObject(input);
  let invoiceParsed: InvoiceDto | undefined;
  if (isObject(raw.invoice)) {
    const result = parseInvoiceDto(raw.invoice);
    if (!result.success) {
      return result;
    }
    invoiceParsed = result.data;
  }

  const paymentAvailable =
    typeof raw.paymentAvailable === 'boolean'
      ? raw.paymentAvailable
      : invoiceParsed
        ? invoiceParsed.status === 'PENDING'
        : true;
  const paymentUrl = typeof raw.paymentUrl === 'string' ? raw.paymentUrl : '';

  return {
    success: true,
    data: {
      success: true,
      data: {
        invoice: invoiceParsed,
        paymentAvailable,
        paymentUrl,
        statusPollingIntervalMs:
          typeof raw.statusPollingIntervalMs === 'number'
            ? raw.statusPollingIntervalMs
            : undefined,
        qrCode: typeof raw.qrCode === 'string' ? raw.qrCode : null,
        stellarQrCode: typeof raw.stellarQrCode === 'string' ? raw.stellarQrCode : null,
        stellarUri: typeof raw.stellarUri === 'string' ? raw.stellarUri : null,
        copyValue: typeof raw.copyValue === 'string' ? raw.copyValue : null,
        networkPassphrase:
          typeof raw.networkPassphrase === 'string' ? raw.networkPassphrase : null,
        stellarQrEncodesUri:
          typeof raw.stellarQrEncodesUri === 'boolean'
            ? raw.stellarQrEncodesUri
            : undefined,
      },
    },
  };
}

/**
 * Validates that an API response adheres to the CancelInvoiceResponse contract.
 */
export function parseCancelInvoiceResponse(
  input: unknown
): ContractResult<CancelInvoiceResponse> {
  if (!isSuccessfulResponse(input)) {
    return { success: false, error: 'Cancel response must be an object' };
  }

  const invoiceParsed = parseInvoiceDto(unwrapInvoiceTarget(unwrapDataObject(input)));
  if (!invoiceParsed.success) {
    return invoiceParsed;
  }

  return {
    success: true,
    data: {
      success: true,
      data: invoiceParsed.data,
    },
  };
}

/**
 * Validates that an API response adheres to the VerifyPaymentResponse contract.
 */
export function parseVerifyPaymentResponse(
  input: unknown
): ContractResult<VerifyPaymentResponse> {
  if (!isSuccessfulResponse(input)) {
    return { success: false, error: 'Verify response must be an object' };
  }

  const invoiceParsed = parseInvoiceDto(unwrapInvoiceTarget(unwrapDataObject(input)));
  if (!invoiceParsed.success) {
    return invoiceParsed;
  }

  return {
    success: true,
    data: {
      success: true,
      data: invoiceParsed.data,
      message: typeof input.message === 'string' ? input.message : undefined,
      code: typeof input.code === 'string' ? input.code : undefined,
      warning: typeof input.warning === 'string' ? input.warning : undefined,
    },
  };
}

/**
 * Validates that an API response adheres to the GetStatsResponse contract.
 * Accepts a bare stats object or a success envelope containing an object or
 * one-element array (the current storage response). The normalized result is
 * always an object. Missing or malformed values must not become zero totals.
 */
export function parseGetStatsResponse(
  input: unknown
): ContractResult<GetStatsResponse> {
  if (!isObject(input)) {
    return { success: false, error: 'Stats response must be an object' };
  }

  const hasOwn = (object: Record<string, unknown>, key: string): boolean =>
    Object.prototype.hasOwnProperty.call(object, key);
  const isEnvelope = hasOwn(input, 'data') || hasOwn(input, 'success');
  if (isEnvelope && (!hasOwn(input, 'success') || input.success !== true || !hasOwn(input, 'data'))) {
    return { success: false, error: 'Stats response must contain success: true and data' };
  }

  const rawData = isEnvelope ? input.data : input;
  if (Array.isArray(rawData) && rawData.length !== 1) {
    return { success: false, error: 'Stats data must contain exactly one stats object' };
  }
  const targetObj = Array.isArray(rawData) ? rawData[0] : rawData;
  if (!isObject(targetObj)) {
    return { success: false, error: 'Stats data must be an object' };
  }

  const countFields = [
    'total_invoices',
    'paid_invoices',
    'pending_invoices',
    'actionable_invoices',
    'expired_invoices',
  ] as const;
  const counts = {} as Pick<InvoiceStatsDto, (typeof countFields)[number]>;
  for (const field of countFields) {
    const value = targetObj[field];
    if (
      !hasOwn(targetObj, field) ||
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      return { success: false, error: `Stats ${field} must be a non-negative safe integer` };
    }
    counts[field] = value;
  }

  const revenue = targetObj.revenue_by_asset;
  if (!hasOwn(targetObj, 'revenue_by_asset') || !isObject(revenue)) {
    return { success: false, error: 'Stats revenue_by_asset must be an object' };
  }
  for (const value of Object.values(revenue)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return { success: false, error: 'Stats asset revenue must be a non-negative finite number' };
    }
  }

  return {
    success: true,
    data: {
      success: true,
      data: {
        ...counts,
        revenue_by_asset: { ...revenue } as Record<string, number>,
      },
    },
  };
}

/**
 * Validates an error response against the standard ApiFailure contract.
 */
export function parseErrorEnvelope(input: unknown): ContractResult<ApiFailure> {
  if (!isObject(input) || input.success !== false || typeof input.error !== 'string') {
    return {
      success: false,
      error:
        'Error response must be an object with success: false and an error string',
    };
  }

  const fieldErrors: Record<string, string> = {};
  if (isObject(input.fieldErrors)) {
    for (const [k, v] of Object.entries(input.fieldErrors)) {
      if (typeof v === 'string') {
        fieldErrors[k] = v;
      }
    }
  }

  return {
    success: true,
    data: {
      success: false,
      error: input.error,
      code: typeof input.code === 'string' ? input.code : undefined,
      field: typeof input.field === 'string' ? input.field : undefined,
      fieldErrors: Object.keys(fieldErrors).length > 0 ? fieldErrors : undefined,
    },
  };
}

/** Canonical OpenAPI 3.0.3 specification for the Quittance Invoice API. */
export const INVOICE_OPENAPI_SPEC = {
  openapi: '3.0.3',
  info: {
    title: 'Quittance Invoice API',
    version: '1.0.0',
    description:
      'Unified invoice API contract published for Express backend and Next.js frontend.',
  },
  paths: {
    '/invoices': {
      post: {
        summary: 'Create an invoice',
        operationId: 'createInvoice',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CreateInvoiceRequest' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Invoice created successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CreateInvoiceResponse' },
              },
            },
          },
          '400': {
            description: 'Validation failure',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ValidationFailureBody' },
              },
            },
          },
        },
      },
      get: {
        summary: 'List invoices for a seller',
        operationId: 'listInvoices',
        parameters: [
          {
            name: 'sellerPublicKey',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
          {
            name: 'q',
            in: 'query',
            required: false,
            schema: { type: 'string' },
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { $ref: '#/components/schemas/InvoiceStatus' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100 },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'List of invoices',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ListInvoicesResponse' },
              },
            },
          },
          '400': {
            description: 'Invalid query parameters',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiFailure' },
              },
            },
          },
        },
      },
    },
    '/invoices/{id}': {
      get: {
        summary: 'Get invoice by ID',
        operationId: 'getInvoice',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Invoice details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GetInvoiceResponse' },
              },
            },
          },
          '404': {
            description: 'Invoice not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiFailure' },
              },
            },
          },
        },
      },
    },
    '/invoices/{id}/payment-info': {
      get: {
        summary: 'Get payment info for an invoice',
        operationId: 'getPaymentInfo',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Payment info and status payload',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/PaymentInfoResponse' },
              },
            },
          },
          '404': {
            description: 'Invoice not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiFailure' },
              },
            },
          },
        },
      },
    },
    '/invoices/{id}/cancel': {
      post: {
        summary: 'Cancel an invoice',
        operationId: 'cancelInvoice',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CancelInvoiceRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Cancelled invoice details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CancelInvoiceResponse' },
              },
            },
          },
          '400': {
            description: 'Cancel rejected',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiFailure' },
              },
            },
          },
        },
      },
    },
    '/invoices/{id}/verify': {
      post: {
        summary: 'Verify a payment transaction against an invoice',
        operationId: 'verifyPayment',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/VerifyPaymentRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Payment verified',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VerifyPaymentResponse' },
              },
            },
          },
          '400': {
            description: 'Verification check failed',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VerificationFailureBody' },
              },
            },
          },
          '404': {
            description: 'Transaction or invoice not found',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VerificationFailureBody' },
              },
            },
          },
          '429': {
            description: 'Rate limit exceeded',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VerificationFailureBody' },
              },
            },
          },
        },
      },
    },
    '/invoices/stats': {
      get: {
        summary: 'Get seller invoice statistics',
        operationId: 'getStats',
        parameters: [
          {
            name: 'sellerPublicKey',
            in: 'query',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description: 'Invoice metrics and volume statistics',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/GetStatsResponse' },
              },
            },
          },
          '400': {
            description: 'Missing or invalid sellerPublicKey',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ApiFailure' },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      InvoiceStatus: {
        type: 'string',
        enum: ['PENDING', 'PAID', 'EXPIRED', 'CANCELLED'],
      },
      InvoiceDto: {
        type: 'object',
        required: [...REQUIRED_INVOICE_DTO_FIELDS],
        properties: {
          id: { type: 'string' },
          sellerPublicKey: { type: 'string' },
          sellerName: { type: 'string' },
          sellerEmail: { type: 'string' },
          amount: { type: 'number' },
          assetCode: { type: 'string' },
          assetIssuer: { type: 'string' },
          memo: { type: 'string' },
          description: { type: 'string' },
          customerName: { type: 'string' },
          customerEmail: { type: 'string' },
          status: { $ref: '#/components/schemas/InvoiceStatus' },
          paymentTxHash: { type: 'string' },
          payerPublicKey: { type: 'string' },
          payerName: { type: 'string' },
          payerEmail: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          paidAt: { type: 'string', format: 'date-time' },
          cancelledAt: { type: 'string', format: 'date-time' },
          settledAt: { type: 'string', format: 'date-time' },
          settlementContext: {
            type: 'string',
            enum: ['ON_TIME', 'AFTER_EXPIRY', 'AFTER_CANCEL'],
          },
          priorStatus: { $ref: '#/components/schemas/InvoiceStatus' },
          latePaymentWarningCode: {
            type: 'string',
            enum: ['PAYMENT_RECEIVED_AFTER_EXPIRY', 'PAYMENT_RECEIVED_AFTER_CANCEL'],
          },
          expiresAt: { type: 'string', format: 'date-time' },
          metadata: { type: 'object' },
        },
      },
      InvoiceStatsDto: {
        type: 'object',
        required: [
          'total_invoices',
          'paid_invoices',
          'pending_invoices',
          'actionable_invoices',
          'expired_invoices',
          'revenue_by_asset',
        ],
        properties: {
          total_invoices: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          paid_invoices: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          pending_invoices: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          actionable_invoices: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          expired_invoices: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          revenue_by_asset: {
            type: 'object',
            additionalProperties: { type: 'number', minimum: 0 },
          },
        },
      },
      ApiFailure: {
        type: 'object',
        required: ['success', 'error'],
        properties: {
          success: { type: 'boolean', enum: [false] },
          error: { type: 'string' },
          code: { type: 'string' },
          field: { type: 'string' },
          fieldErrors: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
      },
      ValidationFailureBody: {
        type: 'object',
        required: ['success', 'code', 'error', 'fieldErrors'],
        properties: {
          success: { type: 'boolean', enum: [false] },
          code: { type: 'string', enum: ['VALIDATION_ERROR'] },
          error: { type: 'string' },
          fieldErrors: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          field: { type: 'string' },
        },
      },
      VerificationFailureBody: {
        type: 'object',
        required: ['success', 'code', 'error'],
        properties: {
          success: { type: 'boolean', enum: [false] },
          code: { type: 'string' },
          error: { type: 'string' },
        },
      },
      CreateInvoiceRequest: {
        type: 'object',
        required: ['amount', 'sellerPublicKey'],
        properties: {
          amount: { type: 'number', minimum: 0.0000001, maximum: 1000000000 },
          assetCode: { type: 'string', default: 'XLM' },
          assetIssuer: { type: 'string' },
          description: { type: 'string', maxLength: 500 },
          customerName: { type: 'string', maxLength: 255 },
          customerEmail: { type: 'string', format: 'email' },
          sellerPublicKey: { type: 'string' },
          sellerName: { type: 'string', maxLength: 255 },
          sellerEmail: { type: 'string', format: 'email' },
          expiresInDays: { type: 'integer', minimum: 1, maximum: 30, default: 7 },
          network: { type: 'string', enum: ['TESTNET', 'PUBLIC'] },
          idempotencyKey: { type: 'string' },
        },
      },
      CreateInvoiceResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            required: ['invoice', 'paymentAvailable', 'paymentUrl'],
            properties: {
              invoice: { $ref: '#/components/schemas/InvoiceDto' },
              paymentAvailable: { type: 'boolean' },
              paymentUrl: { type: 'string' },
              statusPollingIntervalMs: { type: 'integer' },
              qrCode: { type: 'string', nullable: true },
              stellarQrCode: { type: 'string', nullable: true },
              stellarUri: { type: 'string', nullable: true },
              stellarQrEncodesUri: { type: 'boolean' },
              copyValue: { type: 'string', nullable: true },
              networkPassphrase: { type: 'string', nullable: true },
            },
          },
        },
      },
      GetInvoiceResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: '#/components/schemas/InvoiceDto' },
        },
      },
      ListInvoicesResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'array',
            items: { $ref: '#/components/schemas/InvoiceDto' },
          },
          pagination: {
            type: 'object',
            required: ['limit', 'offset', 'total'],
            properties: {
              limit: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
              offset: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
              total: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
            },
          },
        },
      },
      PaymentInfoResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            type: 'object',
            properties: {
              invoice: { $ref: '#/components/schemas/InvoiceDto' },
              paymentAvailable: { type: 'boolean' },
              paymentUrl: { type: 'string' },
              statusPollingIntervalMs: { type: 'integer' },
              qrCode: { type: 'string', nullable: true },
              stellarQrCode: { type: 'string', nullable: true },
              stellarUri: { type: 'string', nullable: true },
              stellarQrEncodesUri: { type: 'boolean' },
              copyValue: { type: 'string', nullable: true },
              networkPassphrase: { type: 'string', nullable: true },
            },
          },
        },
      },
      CancelInvoiceRequest: {
        type: 'object',
        properties: {
          sellerPublicKey: { type: 'string' },
          signature: { type: 'string' },
          message: { type: 'string' },
        },
      },
      CancelInvoiceResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: '#/components/schemas/InvoiceDto' },
        },
      },
      VerifyPaymentRequest: {
        type: 'object',
        required: ['txHash'],
        properties: {
          txHash: { type: 'string', minLength: 64, maxLength: 64 },
          payerName: { type: 'string' },
          payerEmail: { type: 'string' },
          network: { type: 'string' },
        },
      },
      VerifyPaymentResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: { $ref: '#/components/schemas/InvoiceDto' },
          message: { type: 'string' },
          code: { type: 'string' },
          warning: { type: 'string' },
        },
      },
      GetStatsResponse: {
        type: 'object',
        required: ['success', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] },
          data: {
            oneOf: [
              { $ref: '#/components/schemas/InvoiceStatsDto' },
              {
                type: 'array',
                minItems: 1,
                maxItems: 1,
                items: { $ref: '#/components/schemas/InvoiceStatsDto' },
              },
            ],
          },
        },
      },
    },
  },
} as const;
