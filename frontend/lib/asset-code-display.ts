// Asset code normalizer for display.
// Ensures asset codes are presented consistently across the UI: uppercase,
// trimmed, and with a safe fallback for native / missing assets.

const NATIVE_ASSET_CODE = 'XLM';

/**
 * Normalise an asset code for display.
 *
 * @param code - Raw asset code.
 * @returns Canonical display asset code.
 */
export function normalizeAssetCode(code: unknown): string {
  if (typeof code !== 'string') {
    return NATIVE_ASSET_CODE;
  }

  const trimmed = code.trim().toUpperCase();
  if (trimmed === '' || trimmed === 'NATIVE') {
    return NATIVE_ASSET_CODE;
  }

  // Stellar asset codes are 1-12 alphanumeric characters.
  if (!/^[A-Z0-9]{1,12}$/.test(trimmed)) {
    return NATIVE_ASSET_CODE;
  }

  return trimmed;
}
