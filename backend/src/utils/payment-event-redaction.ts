/**
 * payment_events payloads are written for internal attribution and carry
 * whatever context the writer had — including raw memos or contact fields if
 * a writer ever adds them. The seller feed (issue #515) strips identity-shaped
 * keys before rows leave the server so the audit read can never become a PII
 * side channel. Public keys, tx hashes, codes and amounts are kept — they are
 * on-chain data the seller can already see.
 */

const REDACTED_KEY = /memo|email|customername|payername|sellername|description/i;

export function redactPaymentEventData(
  data: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (REDACTED_KEY.test(key)) continue;
    clean[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? redactPaymentEventData(value as Record<string, unknown>)
        : value;
  }
  return clean;
}


/**
 * Webhooks cross a seller-controlled network boundary. Build a new object from
 * approved fields, rather than relying on the internal audit feed's denylist.
 */
export function redactWebhookPayload(input: unknown): import('../../../shared/webhooks').WebhookPayload {
  const object = (value: unknown): Record<string, unknown> | undefined =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  const iso = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
  };
  const data = object(input);
  const eventTypes = [
    'invoice.created', 'invoice.paid', 'invoice.cancelled', 'invoice.expired', 'payment.rejected',
  ];
  const createdAt = iso(data?.createdAt);
  if (
    !data || data.version !== 1 || typeof data.id !== 'string' || !data.id ||
    typeof data.type !== 'string' || !eventTypes.includes(data.type) || !createdAt
  ) {
    throw new Error('Invalid webhook payload');
  }
  const output: Record<string, unknown> = {
    version: 1,
    id: data.id,
    type: data.type,
    createdAt,
  };
  const source = object(data.invoice);
  if (source) {
    const expiresAt = iso(source.expiresAt);
    if (
      typeof source.id !== 'string' || !source.id ||
      typeof source.amount !== 'string' ||
      typeof source.assetCode !== 'string' ||
      typeof source.status !== 'string' ||
      !['PENDING', 'PAID', 'CANCELLED', 'EXPIRED'].includes(source.status) ||
      !expiresAt
    ) {
      throw new Error('Invalid webhook invoice');
    }
    const invoice: Record<string, unknown> = {
      id: source.id,
      amount: source.amount,
      assetCode: source.assetCode,
      status: source.status,
      expiresAt,
    };
    if (typeof source.assetIssuer === 'string') invoice.assetIssuer = source.assetIssuer;
    if (typeof source.paymentTxHash === 'string' && /^[a-fA-F0-9]{64}$/.test(source.paymentTxHash)) {
      invoice.paymentTxHash = source.paymentTxHash;
    }
    const settledAt = iso(source.settledAt);
    if (settledAt) invoice.settledAt = settledAt;
    for (const key of ['settlementContext', 'priorStatus', 'latePaymentWarningCode']) {
      const value = source[key];
      if (typeof value === 'string' && /^[A-Z_]{1,60}$/.test(value)) {
        invoice[key] = value;
      }
    }
    output.invoice = invoice;
  } else if (data.test !== true) {
    throw new Error('Webhook invoice is required');
  }
  const sourcePayment = object(data.payment);
  if (sourcePayment) {
    const payment: Record<string, unknown> = {};
    if (typeof sourcePayment.code === 'string' && /^[A-Z0-9_]{1,100}$/.test(sourcePayment.code)) {
      payment.code = sourcePayment.code;
    }
    if (typeof sourcePayment.txHash === 'string' && /^[a-fA-F0-9]{64}$/.test(sourcePayment.txHash)) {
      payment.txHash = sourcePayment.txHash;
    }
    if (Object.keys(payment).length > 0) output.payment = payment;
  }
  if (data.test === true) output.test = true;
  return output as unknown as import('../../../shared/webhooks').WebhookPayload;
}
