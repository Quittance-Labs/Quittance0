import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
} from '../shared/assets.ts';

const VALID_DESTINATION = 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU';
const ROGUE_ISSUER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

test('registry: XLM and USDC definitions', () => {
  assert.ok(KNOWN_ASSETS.length >= 2);

  const xlm = KNOWN_ASSETS.find((a) => a.code === 'XLM');
  assert.ok(xlm);
  assert.equal(xlm.isNative, true);
  assert.equal(xlm.decimals, 7);
  assert.equal(xlm.issuer, undefined);

  const usdc = KNOWN_ASSETS.find((a) => a.code === 'USDC');
  assert.ok(usdc);
  assert.equal(usdc.isNative, false);
  assert.equal(usdc.decimals, 7);
  assert.equal(usdc.testnetIssuer, USDC_ISSUERS.TESTNET);
  assert.equal(usdc.mainnetIssuer, USDC_ISSUERS.PUBLIC);
  assert.equal(getAssetIssuer('USDC', 'TESTNET'), USDC_ISSUERS.TESTNET);
  assert.equal(getAssetIssuer('USDC', 'PUBLIC'), USDC_ISSUERS.PUBLIC);
  assert.equal(getAssetIssuer('USDC', 'MAINNET'), USDC_ISSUERS.PUBLIC);
  assert.equal(USDT_ISSUERS.TESTNET.startsWith('G'), true);
});

test('normalizeAssetCode and display helpers', () => {
  assert.equal(normalizeAssetCode('xlm'), 'XLM');
  assert.equal(normalizeAssetCode('  usdc  '), 'USDC');
  assert.equal(normalizeAssetCode('native'), 'XLM');
  assert.equal(normalizeAssetCode(''), 'XLM');
  assert.equal(normalizeAssetCode(null), 'XLM');
  assert.equal(decimalsForAsset('USDC'), 7);
  assert.equal(decimalsForAsset('XLM'), STROOP_DECIMALS);
  assert.equal(isNativeAsset('xlm'), true);
  assert.equal(requiresIssuer('USDC'), true);
  assert.equal(requiresIssuer('XLM'), false);
  assert.equal(formatAssetName('usdc'), 'USDC');
  assert.equal(getAssetDefinition('USDT')?.code, 'USDT');
});

test('formatAssetLabel never implies a catalog asset with the wrong issuer', () => {
  assert.equal(formatAssetLabel({ assetCode: 'XLM' }), 'XLM');
  assert.equal(
    formatAssetLabel({ assetCode: 'USDC', assetIssuer: USDC_ISSUERS.TESTNET }),
    'USDC',
  );
  assert.equal(
    formatAssetLabel({ assetCode: 'USDC', assetIssuer: USDC_ISSUERS.PUBLIC }),
    'USDC',
  );
  assert.equal(
    formatAssetLabel({ assetCode: 'USDC', assetIssuer: ROGUE_ISSUER }),
    `USDC:${ROGUE_ISSUER}`,
  );
  assert.equal(formatAssetLabel({ assetCode: 'USDC' }), 'USDC:<no issuer>');
  assert.equal(
    formatAssetLabel({ assetCode: 'XLM', assetIssuer: ROGUE_ISSUER }),
    `XLM:${ROGUE_ISSUER}`,
  );
  assert.equal(isKnownAssetIssuer('USDC', USDC_ISSUERS.TESTNET), true);
  assert.equal(isKnownAssetIssuer('USDC', ROGUE_ISSUER), false);
});

test('string-safe stroop parse/format without float drift', () => {
  assert.equal(STROOPS_PER_UNIT, 10_000_000n);
  assert.equal(parseStroops('1.0000000'), 10_000_000n);
  assert.equal(parseStroops('0.0000001'), 1n);
  assert.equal(parseStroops(1e-7), 1n);
  assert.equal(formatStroops(1n), '0.0000001');
  assert.equal(canonicalAmount('10.5'), '10.5000000');
  assert.equal(amountsEqual('10.0000000', 10), true);
  // Half-up on the 8th decimal.
  assert.equal(parseStroops('1.00000005'), 10_000_001n);
  assert.equal(parseStroops('1.00000004'), 10_000_000n);
});

test('under / over / exact amount cases for XLM and USDC', () => {
  const cases = [
    { asset: 'XLM', expected: '25.0000000', exact: '25.0000000', under: '24.9999999', over: '25.0000001' },
    { asset: 'USDC', expected: '100.0000000', exact: '100.0000000', under: '99.9999999', over: '100.0000001' },
  ];

  for (const c of cases) {
    assert.equal(compareAmounts(c.expected, c.exact), true, `${c.asset} exact`);
    assert.equal(describeAmountDelta(c.expected, c.exact).status, 'exact', `${c.asset} delta exact`);

    assert.equal(isUnderpaid(c.expected, c.under), true, `${c.asset} under`);
    assert.equal(compareAmounts(c.expected, c.under), false, `${c.asset} under mismatch`);
    assert.equal(describeAmountDelta(c.expected, c.under).status, 'underpaid');

    assert.equal(isOverpaid(c.expected, c.over), true, `${c.asset} over`);
    assert.equal(compareAmounts(c.expected, c.over), false, `${c.asset} over mismatch`);
    assert.equal(describeAmountDelta(c.expected, c.over).status, 'overpaid');
  }
});

test('validateAssetAndAmount: XLM and USDC share one create path', () => {
  const xlm = validateAssetAndAmount({ amount: '12.5', assetCode: 'XLM' });
  assert.equal(xlm.ok, true);
  if (xlm.ok) {
    assert.equal(xlm.assetCode, NATIVE_ASSET_CODE);
    assert.equal(xlm.assetIssuer, undefined);
    assert.equal(xlm.amountStr, '12.5000000');
  }

  const xlmWithIssuer = validateAssetAndAmount({
    amount: '1',
    assetCode: 'XLM',
    assetIssuer: USDC_ISSUERS.TESTNET,
  });
  assert.equal(xlmWithIssuer.ok, false);

  const usdc = validateAssetAndAmount({
    amount: '20',
    assetCode: 'USDC',
    network: 'TESTNET',
  });
  assert.equal(usdc.ok, true);
  if (usdc.ok) {
    assert.equal(usdc.assetCode, 'USDC');
    assert.equal(usdc.assetIssuer, USDC_ISSUERS.TESTNET);
    assert.equal(usdc.amountStr, '20.0000000');
  }

  const usdcPublic = validateAssetAndAmount({
    amount: '20',
    assetCode: 'usdc',
    network: 'PUBLIC',
  });
  assert.equal(usdcPublic.ok, true);
  if (usdcPublic.ok) {
    assert.equal(usdcPublic.assetIssuer, USDC_ISSUERS.PUBLIC);
  }

  const missing = validateAssetAndAmount({ amount: '1', assetCode: 'CUSTOM' });
  assert.equal(missing.ok, false);
});

test('verify helpers: asset matching fails closed on look-alikes', () => {
  const nativeInvoice = resolveInvoiceAsset({ assetCode: 'XLM' });
  const usdcInvoice = resolveInvoiceAsset({
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUERS.TESTNET,
  });

  assert.equal(
    assetsMatch(nativeInvoice, resolvePaymentAsset({ assetType: 'native' })),
    true,
  );
  assert.equal(
    assetsMatch(
      nativeInvoice,
      resolvePaymentAsset({
        assetType: 'credit_alphanum4',
        assetCode: 'XLM',
        assetIssuer: ROGUE_ISSUER,
      }),
    ),
    false,
  );
  assert.equal(
    assetsMatch(
      usdcInvoice,
      resolvePaymentAsset({
        assetType: 'credit_alphanum4',
        assetCode: 'USDC',
        assetIssuer: USDC_ISSUERS.TESTNET,
      }),
    ),
    true,
  );
  assert.equal(
    assetsMatch(
      usdcInvoice,
      resolvePaymentAsset({
        assetType: 'credit_alphanum4',
        assetCode: 'USDC',
        assetIssuer: ROGUE_ISSUER,
      }),
    ),
    false,
  );
  assert.equal(
    assetsMatch(resolveInvoiceAsset({ assetCode: 'USDC' }), resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUERS.TESTNET,
    })),
    false,
    'unpinned invoice matches nothing',
  );
  assert.equal(formatAssetIdentity(usdcInvoice), `USDC:${USDC_ISSUERS.TESTNET}`);
});

test('SEP-0007 URI encoding aligns with verify asset rules', () => {
  const xlmUri = encodeSep0007PayUri({
    destination: VALID_DESTINATION,
    amount: '42.5',
    assetCode: 'XLM',
  });
  assert.equal(
    xlmUri,
    `web+stellar:pay?destination=${VALID_DESTINATION}&amount=42.5000000`,
  );
  assert.equal(xlmUri.includes('asset_code'), false);
  assert.equal(xlmUri.includes('asset_issuer'), false);

  const usdcUri = encodeSep0007PayUri({
    destination: VALID_DESTINATION,
    amount: '10',
    assetCode: 'USDC',
    assetIssuer: USDC_ISSUERS.TESTNET,
  });
  assert.equal(
    usdcUri,
    `web+stellar:pay?destination=${VALID_DESTINATION}&amount=10.0000000&asset_code=USDC&asset_issuer=${USDC_ISSUERS.TESTNET}`,
  );

  // Missing issuer for USDC is filled from the registry (same as create).
  const filled = encodeSep0007PayUri({
    destination: VALID_DESTINATION,
    amount: '1',
    assetCode: 'USDC',
    network: 'TESTNET',
  });
  assert.ok(filled.includes(`asset_issuer=${USDC_ISSUERS.TESTNET}`));

  assert.throws(
    () =>
      encodeSep0007PayUri({
        destination: VALID_DESTINATION,
        amount: '1',
        assetCode: 'CUSTOM',
      }),
    /issuer is required/,
  );
});
