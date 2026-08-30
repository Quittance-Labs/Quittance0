import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  assetsMatch,
  formatAssetIdentity,
  requiresIssuer,
  resolveInvoiceAsset,
  resolvePaymentAsset,
} from '../src/utils/asset-helpers';

/**
 * A Stellar asset is the pair (code, issuer). These tests pin the consequence
 * of that: a code on its own identifies nothing, and anyone may issue a credit
 * asset whose code is "XLM".
 */

const ISSUER_A = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
const ISSUER_B = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';

describe('resolvePaymentAsset', () => {
  it('trusts asset_type, not the code, to decide native', () => {
    assert.equal(resolvePaymentAsset({ assetType: 'native' }).kind, 'native');
  });

  it('treats a credit asset coded XLM as credit, never native', () => {
    const asset = resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'XLM',
      assetIssuer: ISSUER_B,
    });

    assert.equal(asset.kind, 'credit');
  });

  it('cannot pin a credit payment with no issuer', () => {
    assert.equal(
      resolvePaymentAsset({ assetType: 'credit_alphanum4', assetCode: 'USDC' }).kind,
      'unpinned',
    );
  });
});

describe('resolveInvoiceAsset', () => {
  it('is native only when it names XLM and records no issuer', () => {
    assert.equal(resolveInvoiceAsset({ assetCode: 'XLM' }).kind, 'native');
    assert.equal(resolveInvoiceAsset({ assetCode: 'XLM', assetIssuer: ISSUER_A }).kind, 'credit');
  });

  it('cannot pin a credit invoice with no issuer', () => {
    assert.equal(resolveInvoiceAsset({ assetCode: 'USDC' }).kind, 'unpinned');
  });
});

describe('assetsMatch', () => {
  const native = resolveInvoiceAsset({ assetCode: 'XLM' });
  const usdcA = resolveInvoiceAsset({ assetCode: 'USDC', assetIssuer: ISSUER_A });

  it('settles native only with native', () => {
    assert.equal(assetsMatch(native, resolvePaymentAsset({ assetType: 'native' })), true);
  });

  it('refuses a fake credit XLM against a native invoice', () => {
    const fake = resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'XLM',
      assetIssuer: ISSUER_B,
    });

    assert.equal(
      assetsMatch(native, fake),
      false,
      'a worthless look-alike must never settle a native invoice',
    );
  });

  it('refuses native against a credit invoice', () => {
    assert.equal(assetsMatch(usdcA, resolvePaymentAsset({ assetType: 'native' })), false);
  });

  it('settles a credit asset only when code and issuer both match', () => {
    const fromA = resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'USDC',
      assetIssuer: ISSUER_A,
    });
    const fromB = resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'USDC',
      assetIssuer: ISSUER_B,
    });

    assert.equal(assetsMatch(usdcA, fromA), true);
    assert.equal(assetsMatch(usdcA, fromB), false, 'same code, different issuer is a different asset');
  });

  it('fails closed when either side is unpinned', () => {
    const unpinnedInvoice = resolveInvoiceAsset({ assetCode: 'USDC' });
    const unpinnedPayment = resolvePaymentAsset({
      assetType: 'credit_alphanum4',
      assetCode: 'USDC',
    });

    assert.equal(assetsMatch(unpinnedInvoice, unpinnedPayment), false);
    assert.equal(
      assetsMatch(unpinnedInvoice, resolvePaymentAsset({
        assetType: 'credit_alphanum4',
        assetCode: 'USDC',
        assetIssuer: ISSUER_A,
      })),
      false,
      'an asset nobody pinned is not an asset anyone agreed to accept',
    );
  });
});

describe('formatAssetIdentity', () => {
  it('uses XLM for native and CODE:ISSUER for credit', () => {
    assert.equal(formatAssetIdentity(resolveInvoiceAsset({ assetCode: 'XLM' })), 'XLM');
    assert.equal(
      formatAssetIdentity(resolveInvoiceAsset({ assetCode: 'USDC', assetIssuer: ISSUER_A })),
      `USDC:${ISSUER_A}`,
    );
  });
});

describe('requiresIssuer', () => {
  it('is true for every code except the native asset', () => {
    assert.equal(requiresIssuer('USDC'), true);
    assert.equal(requiresIssuer('XLM'), false);
    assert.equal(requiresIssuer(''), false);
    assert.equal(requiresIssuer(undefined), false);
  });
});
