import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import QRCode from 'qrcode';
import {
  SEP7_QR_MAX_VERSION,
  fitsSep7QrBudget,
  qrVersionFor,
} from '../src/utils/qr-budget';
import { generateStellarPaymentQR } from '../src/utils/qrcode';
import { formatQrPaymentPayload } from '../src/utils/qr-payment-payload';
import {
  VALID_DESTINATION,
  VALID_ASSET_ISSUER,
} from './fixtures/qr-payment-payload.fixture';

describe('SEP-0007 QR payload budget (#510)', () => {
  const xlmPayload = formatQrPaymentPayload({
    destination: VALID_DESTINATION,
    amount: '42.50',
    memo: 'INV-2026-0001',
  }).uri;

  const usdcPayload = formatQrPaymentPayload({
    destination: VALID_DESTINATION,
    amount: '42.50',
    asset: { code: 'USDC', issuer: VALID_ASSET_ISSUER },
    memo: 'INV-2026-0001',
  }).uri;

  it('an XLM invoice URI fits the budget', () => {
    assert.equal(fitsSep7QrBudget(xlmPayload), true);
    assert.ok(qrVersionFor(xlmPayload) <= SEP7_QR_MAX_VERSION);
  });

  it('a USDC URI with code + issuer + memo exceeds the budget', () => {
    assert.equal(fitsSep7QrBudget(usdcPayload), false);
    assert.ok(qrVersionFor(usdcPayload) > SEP7_QR_MAX_VERSION);
  });

  it('the generated QR still encodes the SEP-0007 URI when it fits', async () => {
    const res = await generateStellarPaymentQR(
      VALID_DESTINATION,
      '42.50',
      'XLM',
      'INV-2026-0001',
      undefined,
      'https://quittance.test/pay/inv_123'
    );

    assert.equal(res.encodesSep7Uri, true);
    assert.match(res.qrDataUrl, /^data:image\/png;base64,/);
    assert.match(res.uri, /^web\+stellar:pay\?/);
    assert.match(res.uri, /destination=/);
    assert.match(res.uri, /memo=INV-2026-0001/);
  });

  it('an over-budget URI encodes the HTTPS pay link instead', async () => {
    const fallback = 'https://quittance.test/pay/inv_123';
    const res = await generateStellarPaymentQR(
      VALID_DESTINATION,
      '42.50',
      'USDC',
      'INV-2026-0001',
      VALID_ASSET_ISSUER,
      fallback
    );

    assert.equal(res.encodesSep7Uri, false);
    assert.match(res.qrDataUrl, /^data:image\/png;base64,/);

    const fallbackQr = await QRCode.toDataURL(fallback, {
      errorCorrectionLevel: 'H',
      width: 400,
      margin: 1,
    });
    assert.equal(res.qrDataUrl, fallbackQr);
  });

  it('the full URI survives the fallback — memo and issuer are never truncated', async () => {
    const res = await generateStellarPaymentQR(
      VALID_DESTINATION,
      '42.50',
      'USDC',
      'INV-2026-0001',
      VALID_ASSET_ISSUER,
      'https://quittance.test/pay/inv_123'
    );

    assert.equal(res.encodesSep7Uri, false);
    assert.match(res.uri, /^web\+stellar:pay\?/);
    assert.match(res.uri, /asset_code=USDC/);
    assert.match(res.uri, new RegExp(`asset_issuer=${VALID_ASSET_ISSUER}`));
    assert.match(res.uri, /memo=INV-2026-0001/);
    assert.match(res.uri, /memo_type=MEMO_TEXT/);
  });

  it('an over-budget URI without a fallback link fails closed', async () => {
    await assert.rejects(
      async () => {
        await generateStellarPaymentQR(
          VALID_DESTINATION,
          '42.50',
          'USDC',
          'INV-2026-0001',
          VALID_ASSET_ISSUER
        );
      },
      /exceeds the QR payload budget/
    );
  });

  it('the version budget itself is pinned', () => {
    assert.equal(SEP7_QR_MAX_VERSION, 12);
    assert.equal(qrVersionFor('x'.repeat(143)), 12);
    assert.equal(qrVersionFor('x'.repeat(229)), 16);
  });
});
