import { createHmac } from 'node:crypto';

export const LOG_EVENTS = [
  'invoice.create.started',
  'invoice.create.succeeded',
  'invoice.create.rejected',
  'payment.attempt.started',
  'payment.attempt.submitted',
  'payment.attempt.rejected',
  'payment.verify.started',
  'payment.verify.rejected',
  'invoice.paid',
  'proof.downloaded',
  'horizon.request.failed',
] as const;

export type LogEventName = typeof LOG_EVENTS[number];
export type LogLevel = 'info' | 'warn' | 'error';

const EVENT_FIELDS: Record<LogEventName, readonly string[]> = {
  'invoice.create.started': ['sellerRef', 'assetCode', 'network', 'storage'],
  'invoice.create.succeeded': ['sellerRef', 'invoiceRef', 'assetCode', 'network', 'storage', 'durationMs'],
  'invoice.create.rejected': ['sellerRef', 'errorCode', 'network', 'storage', 'durationMs'],
  'payment.attempt.started': ['invoiceRef', 'network'],
  'payment.attempt.submitted': ['invoiceRef', 'txRef', 'network', 'durationMs'],
  'payment.attempt.rejected': ['invoiceRef', 'errorCode', 'network', 'durationMs'],
  'payment.verify.started': ['invoiceRef', 'txRef', 'network'],
  'payment.verify.rejected': ['invoiceRef', 'txRef', 'errorCode', 'network', 'durationMs'],
  'invoice.paid': ['invoiceRef', 'sellerRef', 'txRef', 'assetCode', 'network', 'storage', 'durationMs'],
  'proof.downloaded': ['invoiceRef', 'txRef', 'proofFormat'],
  'horizon.request.failed': ['operation', 'errorCode', 'network', 'attempt', 'durationMs'],
};

export interface LogContext {
  requestId: string;
  service: 'api' | 'web';
  environment?: string;
}

export interface StructuredLogRecord {
  timestamp: string;
  level: LogLevel;
  event: LogEventName;
  requestId: string;
  service: 'api' | 'web';
  environment?: string;
  [field: string]: string | number | boolean | undefined;
}

/**
 * Produce a stable, non-reversible reference for a public identifier.
 * With no deployment key, fail closed instead of writing the raw value.
 */
export function logReference(value: unknown, key = process.env.LOG_FINGERPRINT_KEY): string {
  if (typeof value !== 'string' || value.length === 0 || !key) return 'redacted';
  return createHmac('sha256', key).update(value).digest('hex').slice(0, 16);
}

/**
 * Build from an event-specific allowlist. Unknown fields are discarded, so a
 * spread request body cannot leak email, memo, wallet, XDR, URI, or secrets.
 */
export function buildLogRecord(
  level: LogLevel,
  event: LogEventName,
  context: LogContext,
  fields: Record<string, unknown> = {},
  now: Date = new Date()
): StructuredLogRecord {
  const record: StructuredLogRecord = {
    timestamp: now.toISOString(),
    level,
    event,
    requestId: context.requestId,
    service: context.service,
    environment: context.environment,
  };

  for (const field of EVENT_FIELDS[event]) {
    const value = fields[field];
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      record[field] = value;
    }
  }

  return record;
}

let logSink: ((record: StructuredLogRecord) => void) | null = null;

/**
 * Test-only hook so suites can capture emitted records without parsing stdout.
 * Production code must leave this unset.
 */
export function setLogSink(sink: ((record: StructuredLogRecord) => void) | null): void {
  logSink = sink;
}

export function emitLog(record: StructuredLogRecord): void {
  if (logSink) logSink(record);
  const output = JSON.stringify(record);
  if (record.level === 'error') console.error(output);
  else if (record.level === 'warn') console.warn(output);
  else console.log(output);
}

/**
 * Build and emit a structured record in one step.
 */
export function emitEvent(
  level: LogLevel,
  event: LogEventName,
  context: LogContext,
  fields: Record<string, unknown> = {},
  now: Date = new Date()
): StructuredLogRecord {
  const record = buildLogRecord(level, event, context, fields, now);
  emitLog(record);
  return record;
}

export function requiredLogFields(event: LogEventName): readonly string[] {
  return EVENT_FIELDS[event];
}
