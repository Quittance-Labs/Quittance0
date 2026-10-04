/** Public, versioned webhook contract shared by the seller UI and API. */
export const WEBHOOK_EVENT_TYPES = [
  'invoice.created', 'invoice.paid', 'invoice.cancelled', 'invoice.expired', 'payment.rejected',
] as const;
export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[number];
export type WebhookAction = 'list' | 'register' | 'remove' | 'rotate' | 'test';

export interface WebhookProof {
  sellerPublicKey: string;
  action: WebhookAction;
  endpointId?: string;
  url?: string;
  events?: readonly WebhookEventType[];
  timestamp: number;
  nonce: string;
}

/** Bind the complete operation, including destination and filters, to the wallet. */
export function webhookProofMessage(input: WebhookProof): string {
  return JSON.stringify({
    domain: 'quittance-webhooks-v1',
    sellerPublicKey: input.sellerPublicKey,
    action: input.action,
    endpointId: input.endpointId ?? null,
    url: input.url ?? null,
    events: input.events ? [...input.events].sort() : [],
    timestamp: input.timestamp,
    nonce: input.nonce,
  });
}

export interface WebhookPayload {
  version: 1;
  id: string;
  type: WebhookEventType;
  createdAt: string;
  test?: true;
  invoice?: {
    id: string;
    amount: string;
    assetCode: string;
    assetIssuer?: string;
    status: string;
    paymentTxHash?: string;
    settledAt?: string;
    settlementContext?: string;
    priorStatus?: string;
    latePaymentWarningCode?: string;
    expiresAt: string;
  };
  payment?: { code?: string; txHash?: string };
}
