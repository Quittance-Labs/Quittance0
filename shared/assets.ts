/**
 * Canonical Stellar asset and amount subsystem (issue #447).
 *
 * Single source of truth for:
 * 1. Asset registry (code, issuer when required, decimals, display)
 * 2. String-safe parse / format / compare (no floating point)
 * 3. Asset identity resolution used by verify
 * 4. SEP-0007 payment URI encoding aligned with QR + verify rules
 * 5. Create-path asset+amount validation helpers
 *
 * Backend and frontend modules re-export from here so create, QR, verify,
 * dashboard, and proof cannot drift.
 */

/** Stellar's native asset has no issuer; every other code must carry one. */
export const NATIVE_ASSET_CODE = 'XLM';

/** Base32 alphabet, 56 characters, always starting with G. */
const STELLAR_PUBLIC_KEY_PATTERN = /^G[A-Z2-7]{55}$/;

export const STROOP_DECIMALS = 7;
export const STROOPS_PER_UNIT = 10_000_000n;

/** Circle official USDC issuers on Stellar. See docs/USDC-VERIFY-EDGE-CASES.md. */
export const USDC_ISSUERS = Object.freeze({
  TESTNET: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
  PUBLIC: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
});

/** Tether USDT testnet issuer (UI catalog only). */
export const USDT_ISSUERS = Object.freeze({
  TESTNET: 'GCQTGZQQ5G4PTM2GL7CDIFKUBIPEC52BROAQIAPW53XBRJVN6ZJVTG6V',
});

export interface AssetDefinition {
  code: string;
  name: string;
  decimals: number;
  isNative: boolean;
  /** Default (testnet) issuer for credit assets — kept for back-compat. */
  issuer?: string;
  testnetIssuer?: string;
  mainnetIssuer?: string;
  logo: string;
  color: string;
}

/** Canonical registry of supported Stellar assets. */
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
 * Normalize an asset code for display.
 * Uppercases, trims, and turns blank or 'NATIVE' into 'XLM'.
 * Invalid codes fall back to XLM so the UI never renders garbage labels.
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

/** Look up the canonical asset definition for an asset code. */
export function getAssetDefinition(code: unknown): AssetDefinition | undefined {
  const normalized = normalizeAssetCode(code);
  return KNOWN_ASSETS.find((asset) => asset.code === normalized);
}

/** Decimal precision for an asset code (Stellar stroop scale = 7). */
export function decimalsForAsset(assetCode: unknown): number {
  const asset = getAssetDefinition(assetCode);
  return asset ? asset.decimals : STROOP_DECIMALS;
}

/** True when the code names native XLM (after display normalization). */
export function isNativeAsset(code: unknown): boolean {
  return normalizeAssetCode(code) === NATIVE_ASSET_CODE;
}

/** True when a code names a credit asset and therefore requires an issuer. */
export function requiresIssuer(assetCode?: string | null): boolean {
  const code = (assetCode ?? '').trim();
  return code.length > 0 && code !== NATIVE_ASSET_CODE;
}

function normalizeNetwork(network?: string | null): 'TESTNET' | 'PUBLIC' {
  const net = (network || '').toUpperCase();
  if (net === 'PUBLIC' || net === 'MAINNET') return 'PUBLIC';
  return 'TESTNET';
}

/**
 * Canonical issuer for a known credit asset on a given network.
 * Native XLM and unknown codes return undefined.
 */
export function getAssetIssuer(
  code: unknown,
  network: string = 'TESTNET',
): string | undefined {
  const asset = getAssetDefinition(code);
  if (!asset || asset.isNative) {
    return undefined;
  }
  if (normalizeNetwork(network) === 'PUBLIC') {
    return asset.mainnetIssuer || asset.issuer;
  }
  return asset.testnetIssuer || asset.issuer;
}

/** Whether an issuer is one of the known issuers for this asset code. */
export function isKnownAssetIssuer(
  code: unknown,
  issuer: unknown,
): boolean {
  const asset = getAssetDefinition(code);
  if (!asset || asset.isNative) return false;
  if (typeof issuer !== 'string' || !issuer.trim()) return false;
  const trimmed = issuer.trim();
  return (
    trimmed === asset.testnetIssuer ||
    trimmed === asset.mainnetIssuer ||
    trimmed === asset.issuer
  );
}

/** Display name / code for UI chips ("XLM", "USDC"). */
export function formatAssetName(code: unknown): string {
  const asset = getAssetDefinition(code);
  return asset ? asset.code : normalizeAssetCode(code);
}

/**
 * Normalize a code+issuer pair for dashboard and proof labels.
 *
 * - Native / missing → `XLM`
 * - Known credit with a matching Circle (or catalog) issuer → code only
 * - Known credit with a foreign or missing issuer → `CODE:ISSUER` (or
 *   `CODE:<no issuer>`) so the UI never implies the catalog asset.
 * - Unknown credit with issuer → `CODE:ISSUER`
 */
export function formatAssetLabel(fields: {
  assetCode?: string | null;
  assetIssuer?: string | null;
}): string {
  const rawCode = typeof fields.assetCode === 'string' ? fields.assetCode.trim() : '';
  const issuer =
    typeof fields.assetIssuer === 'string' ? fields.assetIssuer.trim() : '';

  if (!rawCode || rawCode.toUpperCase() === 'NATIVE') {
    return NATIVE_ASSET_CODE;
  }

  const code = normalizeAssetCode(rawCode);
  if (code === NATIVE_ASSET_CODE && !issuer) {
    return NATIVE_ASSET_CODE;
  }

  if (code === NATIVE_ASSET_CODE && issuer) {
    // Credit look-alike coded XLM — never display as bare native.
    return `${code}:${issuer}`;
  }

  const known = getAssetDefinition(code);
  if (known && !known.isNative) {
    if (issuer && isKnownAssetIssuer(code, issuer)) {
      return code;
    }
    return issuer ? `${code}:${issuer}` : `${code}:<no issuer>`;
  }

  return issuer ? `${code}:${issuer}` : code;
}

// ---------------------------------------------------------------------------
// String-safe amount math (stroops). No IEEE-754 arithmetic on the hot path.
// ---------------------------------------------------------------------------

export type AmountDeltaStatus = 'exact' | 'underpaid' | 'overpaid' | 'invalid';

export interface AmountDelta {
  status: AmountDeltaStatus;
  expectedStroops: bigint | null;
  actualStroops: bigint | null;
  diffStroops: bigint | null;
  diffFormatted: string | null;
}

/**
 * Expands JavaScript's exponential `toString()` output (`1e-7`, `1.5e+21`)
 * into plain decimal so the digits-only parser below can consume it.
 */
function expandExponential(str: string): string {
  if (!/[eE]/.test(str)) {
    return str;
  }
  const parts = str.split(/[eE]/);
  if (parts.length !== 2) {
    return str;
  }
  const [mantissa, exponentRaw] = parts;
  const exponent = Number.parseInt(exponentRaw, 10);
  if (
    !Number.isFinite(exponent) ||
    !/^[+-]?\d+$/.test(exponentRaw) ||
    !/^-?\d+(\.\d+)?$/.test(mantissa)
  ) {
    return str;
  }
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const dotIndex = unsigned.indexOf('.');
  const digits = unsigned.replace('.', '');
  const dotPosition = dotIndex === -1 ? digits.length : dotIndex;
  const newDot = dotPosition + exponent;
  let expanded: string;
  if (newDot <= 0) {
    expanded = '0.' + '0'.repeat(-newDot) + digits;
  } else if (newDot >= digits.length) {
    expanded = digits + '0'.repeat(newDot - digits.length);
  } else {
    expanded = digits.slice(0, newDot) + '.' + digits.slice(newDot);
  }
  return (negative ? '-' : '') + expanded;
}

/** Convert a string/number/bigint amount into integer stroops, or null. */
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

  str = expandExponential(str);

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

/** Format a BigInt stroop count into a 7-decimal string without float math. */
export function formatStroops(stroops: bigint): string {
  const isNegative = stroops < 0n;
  const absStroops = isNegative ? -stroops : stroops;
  const intPart = absStroops / STROOPS_PER_UNIT;
  const fracPart = (absStroops % STROOPS_PER_UNIT)
    .toString()
    .padStart(STROOP_DECIMALS, '0');
  const formatted = `${intPart.toString()}.${fracPart}`;
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * The one parse-and-format path every amount surface shares: verify, monitor,
 * proofs, and QR payloads all emit the same 7-decimal stroop string.
 */
export function canonicalAmount(value: unknown): string | null {
  const stroops = parseStroops(value);
  return stroops === null ? null : formatStroops(stroops);
}

/** Stroop-exact equality between two amounts. */
export function amountsEqual(expected: unknown, actual: unknown): boolean {
  const expectedStroops = parseStroops(expected);
  const actualStroops = parseStroops(actual);
  return (
    expectedStroops !== null &&
    actualStroops !== null &&
    expectedStroops === actualStroops
  );
}

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
 * Shared create-path check for amount + asset identity.
 * XLM and USDC (and any other credit code) go through this one path.
 */
export function validateAssetAndAmount(input: {
  amount: unknown;
  assetCode?: unknown;
  assetIssuer?: unknown;
  network?: unknown;
}):
  | {
      ok: true;
      amountStr: string;
      amountStroops: bigint;
      assetCode: string;
      assetIssuer?: string;
    }
  | { ok: false; error: string } {
  const stroops = parseStroops(input.amount);
  if (stroops === null || stroops <= 0n) {
    return { ok: false, error: 'Amount must be a positive number' };
  }

  const rawCode =
    typeof input.assetCode === 'string' ? input.assetCode.trim() : '';
  const code = rawCode ? normalizeAssetCode(rawCode) : NATIVE_ASSET_CODE;
  const rawIssuer =
    typeof input.assetIssuer === 'string' ? input.assetIssuer.trim() : '';
  const network =
    typeof input.network === 'string' ? input.network : 'TESTNET';

  if (code === NATIVE_ASSET_CODE) {
    if (rawIssuer) {
      return {
        ok: false,
        error: 'XLM is the native asset and must not carry an issuer',
      };
    }
    return {
      ok: true,
      amountStr: formatStroops(stroops),
      amountStroops: stroops,
      assetCode: NATIVE_ASSET_CODE,
      assetIssuer: undefined,
    };
  }

  const issuer = rawIssuer || getAssetIssuer(code, network);
  if (!issuer) {
    return { ok: false, error: `assetIssuer is required for ${code}` };
  }

  if (!STELLAR_PUBLIC_KEY_PATTERN.test(issuer)) {
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

// ---------------------------------------------------------------------------
// Asset identity (verify). Semantics match the historical asset-helpers module:
// trim only — do not fold invalid codes into XLM, or matching would lie.
// ---------------------------------------------------------------------------

export type AssetIdentity =
  | { kind: 'native'; code: 'XLM' }
  | { kind: 'credit'; code: string; issuer: string }
  | { kind: 'unpinned'; code: string };

export interface AssetFields {
  /** Horizon's `asset_type`: `native`, `credit_alphanum4`, `credit_alphanum12`. */
  assetType?: string;
  assetCode?: string;
  assetIssuer?: string;
}

/**
 * Resolves what a Horizon payment operation actually paid.
 * The asset *type* decides native, not the code.
 */
export function resolvePaymentAsset(fields: AssetFields): AssetIdentity {
  if (fields.assetType === 'native') {
    return { kind: 'native', code: NATIVE_ASSET_CODE };
  }

  const code = (fields.assetCode ?? '').trim();
  const issuer = (fields.assetIssuer ?? '').trim();

  if (!issuer) {
    return { kind: 'unpinned', code };
  }

  return { kind: 'credit', code, issuer };
}

/**
 * Resolves what an invoice is asking to be paid in.
 * Native only when it names `XLM` and records no issuer.
 */
export function resolveInvoiceAsset(fields: {
  assetCode?: string;
  assetIssuer?: string;
}): AssetIdentity {
  const code = (fields.assetCode ?? '').trim();
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
 * Whether a payment settles an invoice's asset.
 * Fails closed: unpinned matches nothing.
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

/** `XLM` for native, `CODE:ISSUER` for credit, `CODE:<no issuer>` when unpinned. */
export function formatAssetIdentity(asset: AssetIdentity): string {
  if (asset.kind === 'native') return NATIVE_ASSET_CODE;
  if (asset.kind === 'unpinned') return `${asset.code}:<no issuer>`;
  return `${asset.code}:${asset.issuer}`;
}

// ---------------------------------------------------------------------------
// SEP-0007 payment URI — same asset rules verify and QR expect.
// ---------------------------------------------------------------------------

export interface Sep0007PayParams {
  destination: string;
  amount: string | number;
  assetCode?: string;
  assetIssuer?: string;
  memo?: string;
  network?: string;
}

/**
 * Build a `web+stellar:pay?` URI with canonical stroop amount encoding.
 *
 * Rules (aligned with backend QR payload formatter + verify):
 * - Native XLM: omit asset_code and asset_issuer
 * - Credit assets: require both asset_code and asset_issuer
 * - Amount is always the canonical 7-decimal stroop string
 * - Parameter order is stable: destination, amount, asset_*, memo*
 */
export function encodeSep0007PayUri(params: Sep0007PayParams): string {
  if (!params || typeof params.destination !== 'string' || !params.destination.trim()) {
    throw new Error('destination is required');
  }

  const destination = params.destination.trim();
  if (!STELLAR_PUBLIC_KEY_PATTERN.test(destination)) {
    throw new Error('destination must be a valid Stellar public key');
  }

  const stroops = parseStroops(params.amount);
  if (stroops === null || stroops <= 0n) {
    throw new Error('amount must be a positive number');
  }

  const rawCode =
    typeof params.assetCode === 'string' ? params.assetCode.trim().toUpperCase() : '';
  const code = rawCode || NATIVE_ASSET_CODE;
  const network = typeof params.network === 'string' ? params.network : 'TESTNET';
  const rawIssuer =
    typeof params.assetIssuer === 'string' ? params.assetIssuer.trim() : '';

  const isNative = code === NATIVE_ASSET_CODE;
  let issuer: string | undefined;

  if (!isNative) {
    issuer = rawIssuer || getAssetIssuer(code, network);
    if (!issuer) {
      throw new Error(`asset issuer is required for ${code}`);
    }
    if (!STELLAR_PUBLIC_KEY_PATTERN.test(issuer)) {
      throw new Error('asset issuer must be a valid Stellar public key');
    }
  }

  const queryParts: string[] = [
    `destination=${encodeURIComponent(destination)}`,
    `amount=${encodeURIComponent(formatStroops(stroops))}`,
  ];

  if (!isNative && issuer) {
    queryParts.push(`asset_code=${encodeURIComponent(code)}`);
    queryParts.push(`asset_issuer=${encodeURIComponent(issuer)}`);
  }

  if (typeof params.memo === 'string' && params.memo !== '') {
    queryParts.push(`memo=${encodeURIComponent(params.memo)}`);
    queryParts.push(`memo_type=${encodeURIComponent('MEMO_TEXT')}`);
  }

  return `web+stellar:pay?${queryParts.join('&')}`;
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
  isKnownAssetIssuer,
  formatAssetName,
  formatAssetLabel,
  parseStroops,
  formatStroops,
  canonicalAmount,
  amountsEqual,
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
