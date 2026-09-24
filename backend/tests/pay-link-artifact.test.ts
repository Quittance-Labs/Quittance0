/**
 * Pay-link artifact — one build for create, the pay page, and the seller copy
 * action (issue #557).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayLinkArtifact } from '../src/utils/pay-link-artifact';
import { formatQrPaymentPayload } from '../src/utils/qr-payment-payload';
import { fitsSep7QrBudget } from '../src/utils/qr-budget';
import {
  VALID_ASSET_ISSUER,
  VALID_DESTINATION,
} from './fixtures/qr-payment-payload.fixture';
import { TESTNET_PASSPHRASE } from '../../shared/network';

const FRONTEND = 'https://quittance.test';
const MEMO = 'INV-LX7Q9A3B-KM2P8NQR';

describe('buildPayLinkArtifact (issue #557)', () => {
  it('returns the HTTPS pay URL, SEP-0007 URI, QR data URL, and fallback flag together', async () => {
    const artifact = await buildPayLinkArtifact({
      invoiceId: 'inv_artifact_1',
      frontendUrl: FRONTEND,
      destination: VALID_DESTINATION,
      amount: '25',
      memo: MEMO,
      network: 'TESTNET',
    });

    assert.equal(artifact.paymentUrl, `${FRONTEND}/pay/inv_artifact_1`);
    assert.match(artifact.stellarUri, /^web\+stellar:pay\?/);
    assert.match(artifact.stellarUri, /amount=25\.0000000/);
    assert.match(artifact.stellarUri, /network_passphrase=/);
    assert.equal(artifact.networkPassphrase, TESTNET_PASSPHRASE);
    assert.match(artifact.qrDataUrl, /^data:image\/png;base64,/);
    assert.equal(typeof artifact.encodesSep7Uri, 'boolean');
    assert.equal(
      artifact.copyValue,
      artifact.encodesSep7Uri ? artifact.stellarUri : artifact.paymentUrl
    );
  });

  it('formats a one-stroop amount as 0.0000001, never 1e-7', async () => {
    const artifact = await buildPayLinkArtifact({
      invoiceId: 'inv_stroop',
      frontendUrl: FRONTEND,
      destination: VALID_DESTINATION,
      amount: 0.0000001,
      memo: MEMO,
      network: 'PUBLIC',
    });

    assert.match(artifact.stellarUri, /amount=0\.0000001/);
    assert.equal(artifact.stellarUri.includes('1e-7'), false);
    assert.equal(artifact.stellarUri.includes('1E-7'), false);
  });

  it('refuses a memo over 28 bytes before a QR is built', async () => {
    await assert.rejects(
      () =>
        buildPayLinkArtifact({
          invoiceId: 'inv_memo',
          frontendUrl: FRONTEND,
          destination: VALID_DESTINATION,
          amount: '1',
          memo: 'A'.repeat(29),
          network: 'PUBLIC',
        }),
      /28-byte/
    );
  });

  it('keeps the full URI as text and encodes the HTTPS link when over QR budget', async () => {
    const artifact = await buildPayLinkArtifact({
      invoiceId: 'inv_usdc',
      frontendUrl: FRONTEND,
      destination: VALID_DESTINATION,
      amount: '42.5',
      memo: MEMO,
      assetCode: 'USDC',
      assetIssuer: VALID_ASSET_ISSUER,
      network: 'TESTNET',
    });

    assert.equal(fitsSep7QrBudget(artifact.stellarUri), false);
    assert.equal(artifact.encodesSep7Uri, false);
    assert.equal(artifact.copyValue, artifact.paymentUrl);
    assert.match(artifact.stellarUri, /asset_code=USDC/);
    assert.match(artifact.stellarUri, new RegExp(`asset_issuer=${VALID_ASSET_ISSUER}`));
    assert.match(artifact.stellarUri, /memo=/);
    assert.match(artifact.qrDataUrl, /^data:image\/png;base64,/);
  });

  it('pins the network passphrase from the same resolver explorer links use', () => {
    const testnet = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '1',
      network: 'TESTNET',
    });
    assert.equal(testnet.params.network_passphrase, TESTNET_PASSPHRASE);

    const publicNet = formatQrPaymentPayload({
      destination: VALID_DESTINATION,
      amount: '1',
      network: 'PUBLIC',
    });
    assert.equal('network_passphrase' in publicNet.params, false);
  });

  it('omits a trailing slash on the frontend base so create and pay agree', async () => {
    const a = await buildPayLinkArtifact({
      invoiceId: 'inv_slash',
      frontendUrl: `${FRONTEND}/`,
      destination: VALID_DESTINATION,
      amount: '1',
      network: 'PUBLIC',
    });
    assert.equal(a.paymentUrl, `${FRONTEND}/pay/inv_slash`);
  });
});
