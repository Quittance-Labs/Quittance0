/**
 * Canonical Stellar asset resolution (issue #246).
 *
 * A Stellar asset is identified by the pair `(code, issuer)`, never by the code
 * alone. `XLM` is the single exception: it is the native asset and has no
 * issuer — but nothing stops anyone issuing a *credit* asset whose code is also
 * the four characters `XLM`. Comparing codes alone therefore lets a worthless
 * look-alike settle a native invoice, which is exactly what this module exists
 * to prevent.
 *
 * See `docs/ASSETS.md`.
 */

export const NATIVE_ASSET_CODE = 'XLM';

/** Either the native asset, or a credit asset pinned to its issuer. */
export type AssetIdentity =
  | { kind: 'native'; code: 'XLM' }
  | { kind: 'credit'; code: string; issuer: string }
  /** A credit asset whose issuer is unknown: never comparable to anything. */
  | { kind: 'unpinned'; code: string };

export interface AssetFields {
  /** Horizon's `asset_type`: `native`, `credit_alphanum4`, `credit_alphanum12`. */
  assetType?: string;
  assetCode?: string;
  assetIssuer?: string;
}

/**
 * Resolves what a Horizon payment operation actually paid.
 *
 * The asset *type* decides, not the code. A payment is native only when Horizon
 * says `asset_type === 'native'`, so a credit asset coded `XLM` resolves as a
 * credit asset and can never match a native invoice.
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
 *
 * An invoice is native only when it names `XLM` *and* records no issuer.
 * A credit invoice with no issuer resolves as `unpinned`, which never matches:
 * an asset nobody pinned is not an asset anyone agreed to accept.
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
 *
 * Fails closed: an `unpinned` asset on either side matches nothing, so a
 * credit invoice created without an issuer cannot be settled at all rather than
 * being settled by anything.
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

/** `XLM` for the native asset, `CODE:ISSUER` for a credit asset. */
export function formatAssetIdentity(asset: AssetIdentity): string {
  if (asset.kind === 'native') return NATIVE_ASSET_CODE;
  if (asset.kind === 'unpinned') return `${asset.code}:<no issuer>`;
  return `${asset.code}:${asset.issuer}`;
}

/** True when a code names a credit asset and therefore requires an issuer. */
export function requiresIssuer(assetCode?: string): boolean {
  const code = (assetCode ?? '').trim();
  return code.length > 0 && code !== NATIVE_ASSET_CODE;
}

export default {
  NATIVE_ASSET_CODE,
  resolvePaymentAsset,
  resolveInvoiceAsset,
  assetsMatch,
  formatAssetIdentity,
  requiresIssuer,
};
