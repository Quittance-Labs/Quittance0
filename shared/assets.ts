/**
 * Canonical Stellar Asset and Amount Subsystem (Issue #447).
 *
 * Single source of truth shared across backend and frontend for:
 * 1. Asset registry (XLM native and USDC with Circle testnet/public issuers, decimals, display)
 * 2. String-safe decimal parsing, formatting, and comparison without float arithmetic
 * 3. SEP-0007 payment URI encoding ensuring verify rules and URI rules remain identical
 * 4. Canonical asset identity resolution, display normalization, and issuer validation
 */

export const STROOP_DECIMALS = 7;
export const STROOPS_PER_UNIT = 10_000_000n;
export const NATIVE_ASSET_CODE = 'XLM';

/**
 * Circle Official USDC Issuers on Stellar.
 * See docs/USDC-VERIFY-EDGE-CASES.md.
 */
export const USDC_ISSUERS = Object.freeze({
  TESTNET: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  PUBLIC: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
});

/**
 * Tether USDT Testnet Issuer.
 */
export const USDT_ISSUERS = Object.freeze({
  TESTNET: 'GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V',
});

export interface AssetDefinition {
  code: string;
  name: string;
  decimals: number;
  isNative: boolean;
  issuer?: string;
  testnetIssuer?: string;
  mainnetIssuer?: string;
  logo: string;
  color: string;
}

/**
 * Canonical registry of supported Stellar assets.
 */
export const KNOWN_ASSETS: readonly AssetDefinition[] = Object.freeze([
  {
    code: 'XLM',
    name: 'Stellar Lumens',
    decimals: 7,
    isNative: true,
    logo: 'https://assets.coingecko.com/coins/images/100/small/stellar-xlm-logo.png',
    color: '#14b6e7',
  },
  {
    code: 'USDC',
    name: 'USD Coin',
    decimals: 7,
    isNative: false,
    issuer: USDC_ISSUERS.TESTNET,
    testnetIssuer: USDC_ISSUERS.TESTNET,
    mainnetIssuer: USDC_ISSUERS.PUBLIC,
    logo: 'https://assets.coingecko.com/coins/images/6319/small/usdc.png',
    color: '#2775ca',
  },
  {
    code: 'USDT',
    name: 'Tether USD',
    decimals: 7,
    isNative: false,
    issuer: USDT_ISSUERS.TESTNET,
    testnetIssuer: USDT_ISSUERS.TESTNET,
    logo: 'https://assets.coingecko.com/coins/images/325/small/tether.png',
    color: '#26a17b',
  },
]);

/**
 * Normalize an asset code for display and comparison.
 * Uppercases, trims, and turns blank or 'NATIVE' into 'XLM'.
 */
export function normalizeAssetCode(code: unknown): string {
  if (typeof code !== 'string') {
    return NATIVE_ASSET_CODE;
  }

  const trimmed = code.trim().toUpperCase();
  if (trimmed === '' || trimmed === 'NATIVE') {
    return NATIVE_ASSET_CODE;
  }

  if (!/^[A-Z0-9]{1,12}$/.test(trimmed)) {
    return NATIVE_ASSET_CODE;
  }

  return trimmed;
}

/**
 * Look up the canonical asset definition for an asset code.
 */
export function getAssetDefinition(code: unknown): AssetDefinition | undefined {
  const normalized = normalizeAssetCode(code);
  return KNOWN_ASSETS.find((asset) => asset.code === normalized);
}

/**
 * Look up decimal precision for an asset code.
 */
export function decimalsForAsset(assetCode: unknown): number {
  const asset = getAssetDefinition(assetCode);
  return asset ? asset.decimals : STROOP_DECIMALS;
}

/**
 * Check if an asset is native XLM.
 */
export function isNativeAsset(code: unknown): boolean {
  return normalizeAssetCode(code) === NATIVE_ASSET_CODE;
}

/**
 * True when an asset is non-native and requires an issuer.
 */
export function requiresIssuer(assetCode: unknown): boolean {
  const normalized = normalizeAssetCode(assetCode);
  return normalized !== NATIVE_ASSET_CODE;
}

/**
 * Get canonical issuer for an asset code on a given network.
 */
export function getAssetIssuer(code: unknown, network: string = 'TESTNET'): string | undefined {
  const asset = getAssetDefinition(code);
  if (!asset || asset.isNative) {
    return undefined;
  }
  const net = (network || '').toUpperCase();
  if (net === 'PUBLIC' || net === 'MAINNET') {
    return asset.mainnetIssuer || asset.issuer;
  }
  return asset.testnetIssuer || asset.issuer;
}

/**
 * Format asset display name (e.g. "XLM" or "USDC").
 */
export function formatAssetName(code: unknown): string {
  const asset = getAssetDefinition(code);
  return asset ? asset.code : normalizeAssetCode(code);
}

export type AmountDeltaStatus = 'exact' | 'underpaid' | 'overpaid' | 'invalid';

export interface AmountDelta {
  status: AmountDeltaStatus;
  expectedStroops: bigint | null;
  actualStroops: bigint | null;
  diffStroops: bigint | null;
  diffFormatted: string | null;
}

/**
 * Converts a string decimal, number, or bigint into integer stroops (10^-7 units).
 * Uses string decimal parsing and half-up rounding on the 8th decimal place.
 */
export function parseStroops(value: unknown): bigint | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    return null;
  }

  let str = '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    str = value.toString();
  } else if (typeof value === 'string') {
    str = value.trim();
    if (!str) {
      return null;
    }
  } else if (typeof value === 'bigint') {
    if (value < 0n) {
      return null;
    }
    return value;
  } else {
    return null;
  }

  if (!/^\d+(\.\d+)?$/.test(str)) {
    return null;
  }

  const parts = str.split('.');
  const intPart = parts[0];
  const fracPart = parts[1] || '';

  if (fracPart.length > STROOP_DECIMALS) {
    const frac7 = fracPart.slice(0, STROOP_DECIMALS);
    const eighthDigit = parseInt(fracPart[STROOP_DECIMALS], 10);
    let stroops = BigInt(intPart) * STROOPS_PER_UNIT + BigInt(frac7);
    if (eighthDigit >= 5) {
      stroops += 1n;
    }
    return stroops;
  }

  const paddedFrac = fracPart.padEnd(STROOP_DECIMALS, '0');
  return BigInt(intPart) * STROOPS_PER_UNIT + BigInt(paddedFrac);
}

/**
 * Formats a BigInt stroop count back into a 7-decimal string without float arithmetic.
 */
export function formatStroops(stroops: bigint): string {
  const isNegative = stroops < 0n;
  const absStroops = isNegative ? -stroops : stroops;
  const intPart = absStroops / STROOPS_PER_UNIT;
  const fracPart = (absStroops % STROOPS_PER_UNIT).toString().padStart(STROOP_DECIMALS, '0');
  const formatted = `${intPart.toString()}.${fracPart}`;
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Compares an expected amount against an observed payment amount within a stroop tolerance.
 */
export function compareAmounts(
  expected: unknown,
  actual: unknown,
  toleranceStroops: number | bigint = 0,
): boolean {
  if (typeof toleranceStroops === 'number') {
    if (!Number.isInteger(toleranceStroops) || toleranceStroops < 0) {
      return false;
    }
  } else if (typeof toleranceStroops === 'bigint') {
    if (toleranceStroops < 0n) {
      return false;
    }
  } else {
    return false;
  }

  const expectedStroops = parseStroops(expected);
  const actualStroops = parseStroops(actual);

  if (expectedStroops === null || actualStroops === null) {
    return false;
  }

  const tol = BigInt(toleranceStroops);
  const diff =
    expectedStroops > actualStroops
      ? expectedStroops - actualStroops
      : actualStroops - expectedStroops;
  return diff <= tol;
}

/**
 * Determines whether the observed payment amount is less than expected beyond tolerance.
 */
export function isUnderpaid(
  expected: unknown,
  actual: unknown,
  toleranceStroops: number | bigint = 0,
): boolean {
  const expectedStroops = parseStroops(expected);
  const actualStroops = parseStroops(actual);

  if (expectedStroops === null || actualStroops === null) {
    return false;
  }

  const tol = BigInt(toleranceStroops);
  return actualStroops < expectedStroops - tol;
}

/**
 * Determines whether the observed payment amount exceeds expected beyond tolerance.
 */
export function isOverpaid(
  expected: unknown,
  actual: unknown,
  toleranceStroops: number | bigint = 0,
): boolean {
  const expectedStroops = parseStroops(expected);
  const actualStroops = parseStroops(actual);

  if (expectedStroops === null || actualStroops === null) {
    return false;
  }

  const tol = BigInt(toleranceStroops);
  return actualStroops > expectedStroops + tol;
}

/**
 * Produces a diagnostic summary describing the difference between expected and actual amounts.
 */
export function describeAmountDelta(expected: unknown, actual: unknown): AmountDelta {
  const expectedStroops = parseStroops(expected);
  const actualStroops = parseStroops(actual);

  if (expectedStroops === null || actualStroops === null) {
    return {
      status: 'invalid',
      expectedStroops,
      actualStroops,
      diffStroops: null,
      diffFormatted: null,
    };
  }

  const diff = actualStroops - expectedStroops;
  const absDiff = diff < 0n ? -diff : diff;

  let status: AmountDeltaStatus = 'exact';
  if (diff < 0n) {
    status = 'underpaid';
  } else if (diff > 0n) {
    status = 'overpaid';
  }

  return {
    status,
    expectedStroops,
    actualStroops,
    diffStroops: diff,
    diffFormatted: formatStroops(absDiff),
  };
}

/**
 * Validates an asset and amount combination for invoice creation.
 */
export function validateAssetAndAmount(input: {
  amount: unknown;
  assetCode?: unknown;
  assetIssuer?: unknown;
}): {
  ok: true;
  amountStr: string;
  amountStroops: bigint;
  assetCode: string;
  assetIssuer?: string;
} | {
  ok: false;
  error: string;
} {
  const stroops = parseStroops(input.amount);
  if (stroops === null || stroops <= 0n) {
    return { ok: false, error: 'Amount must be a positive number' };
  }

  const code = normalizeAssetCode(input.assetCode);
  const rawIssuer = typeof input.assetIssuer === 'string' ? input.assetIssuer.trim() : '';

  if (code === NATIVE_ASSET_CODE) {
    if (rawIssuer) {
      return { ok: false, error: 'XLM is the native asset and must not carry an issuer' };
    }
    return {
      ok: true,
      amountStr: formatStroops(stroops),
      amountStroops: stroops,
      assetCode: NATIVE_ASSET_CODE,
      assetIssuer: undefined,
    };
  }

  const issuer = rawIssuer || getAssetIssuer(code);
  if (!issuer) {
    return { ok: false, error: `assetIssuer is required for ${code}` };
  }

  if (!/^G[A-Z2-7]{55}$/.test(issuer)) {
    return { ok: false, error: 'assetIssuer must be a valid Stellar public key' };
  }

  return {
    ok: true,
    amountStr: formatStroops(stroops),
    amountStroops: stroops,
    assetCode: code,
    assetIssuer: issuer,
  };
}

export type AssetIdentity =
  | { kind: 'native'; code: 'XLM' }
  | { kind: 'credit'; code: string; issuer: string }
  | { kind: 'unpinned'; code: string };

export interface AssetFields {
  assetType?: string;
  assetCode?: string;
  assetIssuer?: string;
}

/**
 * Resolves what a Horizon payment operation actually paid.
 */
export function resolvePaymentAsset(fields: AssetFields): AssetIdentity {
  if (fields.assetType === 'native') {
    return { kind: 'native', code: NATIVE_ASSET_CODE };
  }

  const code = normalizeAssetCode(fields.assetCode ?? '');
  const issuer = (fields.assetIssuer ?? '').trim();

  if (!issuer) {
    return { kind: 'unpinned', code };
  }

  return { kind: 'credit', code, issuer };
}

/**
 * Resolves what an invoice asks to be paid in.
 */
export function resolveInvoiceAsset(fields: {
  assetCode?: string;
  assetIssuer?: string;
}): AssetIdentity {
  const code = normalizeAssetCode(fields.assetCode ?? '');
  const issuer = (fields.assetIssuer ?? '').trim();

  if (code === NATIVE_ASSET_CODE && !issuer) {
    return { kind: 'native', code: NATIVE_ASSET_CODE };
  }

  if (!issuer) {
    return { kind: 'unpinned', code };
  }

  return { kind: 'credit', code, issuer };
}

/**
 * Evaluates whether two asset identities match for invoice settlement.
 */
export function assetsMatch(invoice: AssetIdentity, payment: AssetIdentity): boolean {
  if (invoice.kind === 'unpinned' || payment.kind === 'unpinned') {
    return false;
  }

  if (invoice.kind === 'native' || payment.kind === 'native') {
    return invoice.kind === 'native' && payment.kind === 'native';
  }

  return invoice.code === payment.code && invoice.issuer === payment.issuer;
}

/**
 * Formats an asset identity as 'XLM' or 'CODE:ISSUER'.
 */
export function formatAssetIdentity(asset: AssetIdentity): string {
  if (asset.kind === 'native') return NATIVE_ASSET_CODE;
  if (asset.kind === 'unpinned') return `${asset.code}:<no issuer>`;
  return `${asset.code}:${asset.issuer}`;
}

export interface Sep0007PayParams {
  destination: string;
  amount?: string | number;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  memoType?: string;
  networkPassphrase?: string;
}

/**
 * Formats a standards-compliant SEP-0007 payment URI (web+stellar:pay).
 *
 * Rules:
 * 1. For native XLM: omit asset_code and asset_issuer.
 * 2. For non-native assets (e.g. USDC): include both asset_code and asset_issuer.
 * 3. Preserve exact decimal representation of amount without float loss.
 */
export function encodeSep0007PayUri(params: Sep0007PayParams): string {
  if (!params || !params.destination || typeof params.destination !== 'string') {
    throw new Error('Destination public key is required for SEP-0007 payment URI');
  }

  const destination = params.destination.trim();
  if (!destination) {
    throw new Error('Destination public key is required for SEP-0007 payment URI');
  }

  const searchParams = new URLSearchParams();
  searchParams.set('destination', destination);

  if (params.amount !== undefined && params.amount !== null && params.amount !== '') {
    const amountStr = typeof params.amount === 'number' ? params.amount.toString() : params.amount.trim();
    if (amountStr) {
      searchParams.set('amount', amountStr);
    }
  }

  const code = params.assetCode ? normalizeAssetCode(params.assetCode) : NATIVE_ASSET_CODE;
  if (code !== NATIVE_ASSET_CODE) {
    searchParams.set('asset_code', code);
    const issuer = (params.assetIssuer || getAssetIssuer(code) || '').trim();
    if (issuer) {
      searchParams.set('asset_issuer', issuer);
    }
  }

  if (params.memo && params.memo.trim() !== '') {
    searchParams.set('memo', params.memo.trim());
    searchParams.set('memo_type', params.memoType ? params.memoType.trim() : 'MEMO_TEXT');
  }

  if (params.networkPassphrase && params.networkPassphrase.trim() !== '') {
    searchParams.set('network_passphrase', params.networkPassphrase.trim());
  }

  return `web+stellar:pay?${searchParams.toString()}`;
}

export const buildSep0007PayUri = encodeSep0007PayUri;

export default {
  STROOP_DECIMALS,
  STROOPS_PER_UNIT,
  NATIVE_ASSET_CODE,
  USDC_ISSUERS,
  USDT_ISSUERS,
  KNOWN_ASSETS,
  normalizeAssetCode,
  getAssetDefinition,
  decimalsForAsset,
  isNativeAsset,
  requiresIssuer,
  getAssetIssuer,
  formatAssetName,
  parseStroops,
  formatStroops,
  compareAmounts,
  isUnderpaid,
  isOverpaid,
  describeAmountDelta,
  validateAssetAndAmount,
  resolvePaymentAsset,
  resolveInvoiceAsset,
  assetsMatch,
  formatAssetIdentity,
  encodeSep0007PayUri,
  buildSep0007PayUri,
};
