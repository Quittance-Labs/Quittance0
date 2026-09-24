/**
 * USDC pay preflight (issue #506).
 *
 * A credit-asset payment fails at submit with an opaque `op_no_trust` when the
 * payer's account cannot hold the asset. These helpers classify the payer's
 * Horizon account before Freighter ever opens so the pay page can block the
 * submit with an actionable message instead. Pure functions only — the SDK
 * lookup stays in `lib/stellar.ts`, which wraps this module.
 */

export type TrustlinePreflightCode =
  | 'OK'
  | 'NATIVE_ASSET'
  | 'MISSING_TRUSTLINE'
  | 'ACCOUNT_NOT_FOUND'
  | 'HORIZON_UNAVAILABLE';

export interface TrustlinePreflight {
  ok: boolean;
  code: TrustlinePreflightCode;
  message?: string;
  /** True when the failure is a transient lookup problem worth retrying. */
  retryable?: boolean;
}

export interface TrustlineBalanceLike {
  asset_type?: string;
  asset_code?: string;
  asset_issuer?: string;
}

export interface TrustlineAccountLike {
  balances?: TrustlineBalanceLike[];
}

export function accountHasTrustline(
  account: TrustlineAccountLike | null | undefined,
  assetCode: string,
  assetIssuer: string
): boolean {
  return Boolean(
    account?.balances?.some(
      (balance) =>
        balance.asset_type !== 'native' &&
        balance.asset_code === assetCode &&
        balance.asset_issuer === assetIssuer
    )
  );
}

/** 404 means the account is unfunded; anything else is a Horizon outage. */
export function classifyAccountLookupError(
  error: unknown
): 'ACCOUNT_NOT_FOUND' | 'HORIZON_UNAVAILABLE' {
  const status = (error as { response?: { status?: number } })?.response?.status;
  const message = String((error as { message?: string })?.message ?? '');
  if (status === 404 || message.includes('Not Found')) {
    return 'ACCOUNT_NOT_FOUND';
  }
  return 'HORIZON_UNAVAILABLE';
}

export function trustlinePreflightMessage(
  code: Exclude<TrustlinePreflightCode, 'OK' | 'NATIVE_ASSET'>,
  assetCode: string,
  networkLabel: string
): string {
  switch (code) {
    case 'MISSING_TRUSTLINE':
      return `Your wallet does not have a ${assetCode} trustline on ${networkLabel}. Add the ${assetCode} trustline in Freighter, or ask the seller for an XLM invoice.`;
    case 'ACCOUNT_NOT_FOUND':
      return `Your wallet account is not funded on ${networkLabel}. Fund it first — an unfunded account cannot hold ${assetCode}.`;
    case 'HORIZON_UNAVAILABLE':
      return 'Could not reach the Stellar network to check your balances. Check your connection and try again.';
  }
}

/**
 * Classify a payer account lookup for a credit-asset payment. `account` is the
 * resolved Horizon account (or null) and `error` the lookup failure, if any.
 * Native XLM never reaches this classifier — callers skip the lookup entirely.
 */
export function classifyTrustlinePreflight(input: {
  assetCode: string;
  assetIssuer?: string | null;
  account?: TrustlineAccountLike | null;
  error?: unknown;
  networkLabel?: string;
}): TrustlinePreflight {
  const assetCode = (input.assetCode || 'XLM').toUpperCase();
  const networkLabel = input.networkLabel || 'Stellar';

  if (assetCode === 'XLM') {
    return { ok: true, code: 'NATIVE_ASSET' };
  }

  if (input.error) {
    const code = classifyAccountLookupError(input.error);
    return {
      ok: false,
      code,
      retryable: code === 'HORIZON_UNAVAILABLE',
      message: trustlinePreflightMessage(code, assetCode, networkLabel),
    };
  }

  if (!input.account) {
    return {
      ok: false,
      code: 'ACCOUNT_NOT_FOUND',
      message: trustlinePreflightMessage('ACCOUNT_NOT_FOUND', assetCode, networkLabel),
    };
  }

  if (!input.assetIssuer || !accountHasTrustline(input.account, assetCode, input.assetIssuer)) {
    return {
      ok: false,
      code: 'MISSING_TRUSTLINE',
      message: trustlinePreflightMessage('MISSING_TRUSTLINE', assetCode, networkLabel),
    };
  }

  return { ok: true, code: 'OK' };
}

/** Verify-rejection codes the trustline UI must never recycle (issue #506). */
export const VERIFY_REJECTION_MARKERS = [
  'MEMO_MISMATCH',
  'AMOUNT_MISMATCH',
  'DESTINATION_MISMATCH',
  'VERIFY_REJECTED',
  'memo does not match',
  'amount does not match',
] as const;

/** True when copy looks like a verify rejection rather than a trustline message. */
export function looksLikeVerifyRejection(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return VERIFY_REJECTION_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
}
