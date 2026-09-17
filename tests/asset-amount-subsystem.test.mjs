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
} from '../shared/assets.ts';

const VALID_DESTINATION = 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU';
const ROGUE_ISSUER = 'GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2G2Z2K5T3LNYV27XGCTP4';

test('1. Asset Registry and Normalization Contract', async (t) => {
  await t.test('KNOWN_ASSETS contains canonical XLM, USDC, and USDT definitions', () => {
    assert.equal(KNOWN_ASSETS.length >= 2, true);

    const xlm = KNOWN_ASSETS.find((a) => a.code === 'XLM');
    assert.ok(xlm, 'XLM must be registered');
    assert.equal(xlm.isNative, true);
    assert.equal(xlm.decimals, 7);
    assert.equal(xlm.issuer, undefined);

    const usdc = KNOWN_ASSETS.find((a) => a.code === 'USDC');
    assert.ok(usdc, 'USDC must be registered');
    assert.equal(usdc.isNative, false);
    assert.equal(usdc.decimals, 7);
    assert.equal(usdc.testnetIssuer, USDC_ISSUERS.TESTNET);
    assert.equal(usdc.mainnetIssuer, USDC_ISSUERS.PUBLIC);
    assert.equal(usdc.issuer, USDC_ISSUERS.TESTNET);
  });

  await t.test('normalizeAssetCode handles edge cases consistently', () => {
    assert.equal(normalizeAssetCode('xlm'), 'XLM');
    assert.equal(normalizeAssetCode('  XLM  '), 'XLM');
    assert.equal(normalizeAssetCode('native'), 'XLM');
    assert.equal(normalizeAssetCode('NATIVE'), 'XLM');
    assert.equal(normalizeAssetCode(''), 'XLM');
    assert.equal(normalizeAssetCode(null), 'XLM');
    assert.equal(normalizeAssetCode(undefined), 'XLM');
    assert.equal(normalizeAssetCode('usdc'), 'USDC');
    assert.equal(normalizeAssetCode('  usdc  '), 'USDC');
    assert.equal(normalizeAssetCode('TOOLONGLONGASSETCODE123'), 'XLM');
    assert.equal(normalizeAssetCode('INVALID$$'), 'XLM');
  });

  await t.test('decimalsForAsset returns 7 for all Stellar assets', () => {
    assert.equal(decimalsForAsset('XLM'), 7);
    assert.equal(decimalsForAsset('USDC'), 7);
    assert.equal(decimalsForAsset('USDT'), 7);
    assert.equal(decimalsForAsset('UNKNOWN'), 7);
  });

  await t.test('requiresIssuer identifies credit vs native assets', () => {
    assert.equal(requiresIssuer('XLM'), false);
    assert.equal(requiresIssuer('xlm'), false);
    assert.equal(requiresIssuer('native'), false);
    assert.equal(requiresIssuer('USDC'), true);
    assert.equal(requiresIssuer('USDT'), true);
    assert.equal(requiresIssuer('BTC'), true);
  });

  await t.test('getAssetIssuer returns appropriate network issuer', () => {
    assert.equal(getAssetIssuer('XLM', 'TESTNET'), undefined);
    assert.equal(getAssetIssuer('XLM', 'PUBLIC'), undefined);
    assert.equal(getAssetIssuer('USDC', 'TESTNET'), USDC_ISSUERS.TESTNET);
    assert.equal(getAssetIssuer('USDC', 'PUBLIC'), USDC_ISSUERS.PUBLIC);
  });
});

test('2. String-Safe Decimal Arithmetic (No Floating Point Drift)', async (t) => {
  await t.test('parseStroops parses integers and exact 7-decimal fractions', () => {
    assert.equal(parseStroops('1'), 10_000_000n);
    assert.equal(parseStroops('0.0000001'), 1n);
    assert.equal(parseStroops('100.5000000'), 1_005_000_000n);
    assert.equal(parseStroops('25'), 250_000_000n);
    assert.equal(parseStroops(25), 250_000_000n);
    assert.equal(parseStroops(250_000_000n), 250_000_000n);
  });

  await t.test('parseStroops executes half-up rounding on sub-stroop 8th decimal digit', () => {
    assert.equal(parseStroops('10.00000004'), 100_000_000n);
    assert.equal(parseStroops('10.00000005'), 100_000_001n);
  });

  await t.test('parseStroops rejects invalid inputs', () => {
    assert.equal(parseStroops(null), null);
    assert.equal(parseStroops(undefined), null);
    assert.equal(parseStroops(''), null);
    assert.equal(parseStroops('   '), null);
    assert.equal(parseStroops('-5'), null);
    assert.equal(parseStroops(-5), null);
    assert.equal(parseStroops('abc'), null);
    assert.equal(parseStroops({}), null);
    assert.equal(parseStroops(NaN), null);
    assert.equal(parseStroops(Infinity), null);
  });

  await t.test('formatStroops produces fixed 7-decimal string without float math', () => {
    assert.equal(formatStroops(10_000_000n), '1.0000000');
    assert.equal(formatStroops(1n), '0.0000001');
    assert.equal(formatStroops(0n), '0.0000000');
    assert.equal(formatStroops(1_005_000_000n), '100.5000000');
    assert.equal(formatStroops(-10_000_000n), '-1.0000000');
  });

  await t.test('compareAmounts eliminates binary floating point precision error', () => {
    const sumStroops = parseStroops('0.1') + parseStroops('0.2');
    assert.equal(sumStroops, parseStroops('0.3'));
    assert.equal(compareAmounts(formatStroops(sumStroops), '0.3'), true);
  });

  await t.test('underpayment and overpayment detection', () => {
    const expected = '50.0000000';
    assert.equal(compareAmounts(expected, '50.0000000'), true);
    assert.equal(isUnderpaid(expected, '49.9999999'), true);
    assert.equal(isUnderpaid(expected, '50.0000000'), false);
    assert.equal(isUnderpaid(expected, '50.0000001'), false);

    assert.equal(isOverpaid(expected, '50.0000001'), true);
    assert.equal(isOverpaid(expected, '50.0000000'), false);
    assert.equal(isOverpaid(expected, '49.9999999'), false);

    const underDelta = describeAmountDelta(expected, '45.0000000');
    assert.equal(underDelta.status, 'underpaid');
    assert.equal(underDelta.diffFormatted, '5.0000000');

    const overDelta = describeAmountDelta(expected, '55.0000000');
    assert.equal(overDelta.status, 'overpaid');
    assert.equal(overDelta.diffFormatted, '5.0000000');

    const exactDelta = describeAmountDelta(expected, '50.0000000');
    assert.equal(exactDelta.status, 'exact');
    assert.equal(exactDelta.diffStroops, 0n);
  });
});

test('3. Asset Identity & Verification Resolution', async (t) => {
  await t.test('native XLM invoice and payment matching', () => {
    const invoiceAsset = resolveInvoiceAsset({ assetCode: 'XLM' });
    assert.deepEqual(invoiceAsset, { kind: 'native', code: 'XLM' });

    const nativePayment = resolvePaymentAsset({ assetType: 'native' });
    assert.deepEqual(nativePayment, { kind: 'native', code: 'XLM' });

    assert.equal(assetsMatch(invoiceAsset, nativePayment), true);
  });

  await t.test('credit asset coded XLM can NEVER settle a native invoice', () => {
    const invoiceAsset = resolveInvoiceAsset({ assetCode: 'XLM' });
    const counterfeitPayment = resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'XLM',
      assetIssuer: ROGUE_ISSUER,
    });

    assert.equal(assetsMatch(invoiceAsset, counterfeitPayment), false);
  });

  await t.test('USDC Circle issuer matching vs counterfeit issuer rejection', () => {
    const invoiceAsset = resolveInvoiceAsset({
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUERS.TESTNET,
    });
    assert.deepEqual(invoiceAsset, {
      kind: 'credit',
      code: 'USDC',
      issuer: USDC_ISSUERS.TESTNET,
    });

    const validPayment = resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUERS.TESTNET,
    });
    assert.equal(assetsMatch(invoiceAsset, validPayment), true);

    const roguePayment = resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'USDC',
      assetIssuer: ROGUE_ISSUER,
    });
    assert.equal(assetsMatch(invoiceAsset, roguePayment), false);
  });

  await t.test('unpinned invoice or payment fails closed', () => {
    const unpinnedInvoice = resolveInvoiceAsset({ assetCode: 'USDC' });
    assert.equal(unpinnedInvoice.kind, 'unpinned');

    const validPayment = resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUERS.TESTNET,
    });
    assert.equal(assetsMatch(unpinnedInvoice, validPayment), false);
  });
});

test('4. SEP-0007 QR and Payment URI Encoding Conformance', async (t) => {
  await t.test('native XLM payment URI omits asset_code and asset_issuer', () => {
    const uri = encodeSep0007PayUri({
      destination: VALID_DESTINATION,
      amount: '25.0000000',
      assetCode: 'XLM',
      memo: 'INV-TEST-001',
    });

    assert.equal(
      uri,
      `web+stellar:pay?destination=${VALID_DESTINATION}&amount=25.0000000&memo=INV-TEST-001&memo_type=MEMO_TEXT`
    );
    assert.equal(uri.includes('asset_code'), false);
    assert.equal(uri.includes('asset_issuer'), false);
  });

  await t.test('credit USDC payment URI includes both asset_code and asset_issuer', () => {
    const uri = encodeSep0007PayUri({
      destination: VALID_DESTINATION,
      amount: '100.0000000',
      assetCode: 'USDC',
      assetIssuer: USDC_ISSUERS.TESTNET,
      memo: 'INV-TEST-002',
    });

    assert.equal(
      uri,
      `web+stellar:pay?destination=${VALID_DESTINATION}&amount=100.0000000&asset_code=USDC&asset_issuer=${USDC_ISSUERS.TESTNET}&memo=INV-TEST-002&memo_type=MEMO_TEXT`
    );
  });

  await t.test('omitted issuer for USDC automatically resolves Circle testnet issuer', () => {
    const uri = encodeSep0007PayUri({
      destination: VALID_DESTINATION,
      amount: '50.0000000',
      assetCode: 'USDC',
    });

    assert.equal(
      uri,
      `web+stellar:pay?destination=${VALID_DESTINATION}&amount=50.0000000&asset_code=USDC&asset_issuer=${USDC_ISSUERS.TESTNET}`
    );
  });

  await t.test('throws when destination is missing or empty', () => {
    assert.throws(() => encodeSep0007PayUri({ destination: '' }), /Destination public key is required/);
    assert.throws(() => encodeSep0007PayUri(null), /Destination public key is required/);
  });
});

test('5. Single Unified Validation Path for XLM and USDC Invoice Creation', async (t) => {
  await t.test('accepts valid XLM amount without issuer', () => {
    const res = validateAssetAndAmount({
      amount: '15.5',
      assetCode: 'XLM',
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.amountStr, '15.5000000');
      assert.equal(res.amountStroops, 155_000_000n);
      assert.equal(res.assetCode, 'XLM');
      assert.equal(res.assetIssuer, undefined);
    }
  });

  await t.test('rejects XLM amount if carrying an issuer', () => {
    const res = validateAssetAndAmount({
      amount: '15.5',
      assetCode: 'XLM',
      assetIssuer: USDC_ISSUERS.TESTNET,
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.error, /native asset and must not carry an issuer/i);
    }
  });

  await t.test('accepts valid USDC amount and attaches Circle testnet issuer', () => {
    const res = validateAssetAndAmount({
      amount: '75',
      assetCode: 'USDC',
    });
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.amountStr, '75.0000000');
      assert.equal(res.amountStroops, 750_000_000n);
      assert.equal(res.assetCode, 'USDC');
      assert.equal(res.assetIssuer, USDC_ISSUERS.TESTNET);
    }
  });

  await t.test('rejects negative, zero, or non-numeric amount for both assets', () => {
    assert.equal(validateAssetAndAmount({ amount: '0', assetCode: 'XLM' }).ok, false);
    assert.equal(validateAssetAndAmount({ amount: '-10', assetCode: 'USDC' }).ok, false);
    assert.equal(validateAssetAndAmount({ amount: 'not-a-number', assetCode: 'USDC' }).ok, false);
  });
});
