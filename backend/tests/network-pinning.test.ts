import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveStellarNetwork,
  passphraseFor,
  defaultHorizonUrl,
  explorerSegmentFor,
  walletNetworkMatches,
  TESTNET_PASSPHRASE,
  PUBLIC_PASSPHRASE,
} from '../../shared/network.ts';
import { deploymentReadiness } from '../src/config/runtime.ts';
import { buildQuittanceProof } from '../src/services/quittance-proof.service.ts';
import { buildHorizonTxUrl } from '../src/utils/explorer-tx-link.ts';

describe('Stellar Network Pinning Suite (#511)', () => {
  describe('Canonical Network Resolution', () => {
    it('resolves TESTNET and variations accurately', () => {
      assert.equal(resolveStellarNetwork('TESTNET'), 'TESTNET');
      assert.equal(resolveStellarNetwork('testnet'), 'TESTNET');
      assert.equal(resolveStellarNetwork('  testnet  '), 'TESTNET');
      assert.equal(resolveStellarNetwork(undefined), 'TESTNET');
      assert.equal(resolveStellarNetwork(null), 'TESTNET');
      assert.throws(() => resolveStellarNetwork('invalid'), /Stellar network must be one of/);
    });

    it('resolves PUBLIC and rejects non-supported network aliases', () => {
      assert.equal(resolveStellarNetwork('PUBLIC'), 'PUBLIC');
      assert.equal(resolveStellarNetwork('public'), 'PUBLIC');
      assert.equal(resolveStellarNetwork('  public  '), 'PUBLIC');
      assert.throws(() => resolveStellarNetwork('PUBNET'), /Stellar network must be one of/);
      assert.throws(() => resolveStellarNetwork('MAINNET'), /Stellar network must be one of/);
    });

    it('returns canonical passphrases for networks', () => {
      assert.equal(passphraseFor('TESTNET'), TESTNET_PASSPHRASE);
      assert.equal(passphraseFor('PUBLIC'), PUBLIC_PASSPHRASE);
    });

    it('returns default horizon URLs for networks', () => {
      assert.equal(defaultHorizonUrl('TESTNET'), 'https://horizon-testnet.stellar.org');
      assert.equal(defaultHorizonUrl('PUBLIC'), 'https://horizon.stellar.org');
    });

    it('returns explorer segments for networks', () => {
      assert.equal(explorerSegmentFor('TESTNET'), 'testnet');
      assert.equal(explorerSegmentFor('PUBLIC'), 'public');
    });
  });

  describe('Wallet Network and Passphrase Matching', () => {
    it('accepts matching network passphrase and name', () => {
      assert.equal(
        walletNetworkMatches('TESTNET', {
          network: 'TESTNET',
          networkPassphrase: TESTNET_PASSPHRASE,
        }),
        true
      );
      assert.equal(
        walletNetworkMatches('PUBLIC', {
          network: 'PUBLIC',
          networkPassphrase: PUBLIC_PASSPHRASE,
        }),
        true
      );
    });

    it('blocks mismatched network passphrase or network name', () => {
      assert.equal(
        walletNetworkMatches('TESTNET', {
          network: 'PUBLIC',
          networkPassphrase: TESTNET_PASSPHRASE,
        }),
        false
      );
      assert.equal(
        walletNetworkMatches('TESTNET', {
          network: 'TESTNET',
          networkPassphrase: PUBLIC_PASSPHRASE,
        }),
        false
      );
      assert.equal(
        walletNetworkMatches('TESTNET', {
          network: 'PUBLIC',
          networkPassphrase: PUBLIC_PASSPHRASE,
        }),
        false
      );
    });

    it('blocks when neither network nor passphrase is provided', () => {
      assert.equal(walletNetworkMatches('TESTNET', {}), false);
      assert.equal(walletNetworkMatches('TESTNET', { network: null, networkPassphrase: null }), false);
    });
  });

  describe('Deployment Readiness and HTTPS Validation', () => {
    const baseProd = {
      NODE_ENV: 'production',
      FRONTEND_URL: 'https://quittance.vercel.app',
      STELLAR_NETWORK: 'TESTNET',
      STELLAR_HORIZON_URL: 'https://horizon-testnet.stellar.org',
    };

    it('passes deployment readiness with valid HTTPS horizon URL in production', () => {
      const res = deploymentReadiness(baseProd);
      assert.equal(res.ready, true);
    });

    it('fails deployment readiness when STELLAR_HORIZON_URL lacks HTTPS in production', () => {
      const res = deploymentReadiness({
        ...baseProd,
        STELLAR_HORIZON_URL: 'http://horizon-testnet.stellar.org',
      });
      assert.equal(res.ready, false);
      assert.ok(
        res.reasons.some((r) => r.includes('STELLAR_HORIZON_URL must use HTTPS'))
      );
    });

    it('fails deployment readiness when STELLAR_NETWORK is invalid in production', () => {
      const res = deploymentReadiness({
        ...baseProd,
        STELLAR_NETWORK: 'UNRECOGNIZED_CHAIN',
      });
      assert.equal(res.ready, false);
      assert.ok(
        res.reasons.some((r) => r.includes('STELLAR_NETWORK must be TESTNET or PUBLIC'))
      );
    });
  });

  describe('Proof Explorer URL for TESTNET Invoices', () => {
    const mockTestnetInvoice = {
      id: 'inv-test-net-1',
      sellerPublicKey: 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H',
      amount: '50.0000000',
      assetCode: 'XLM',
      memo: 'TESTNETMEMO1',
      status: 'PAID' as const,
      network: 'TESTNET',
      paidAt: '2026-03-20T12:00:00.000Z',
      paymentTxHash: 'c'.repeat(64),
      createdAt: '2026-03-20T10:00:00.000Z',
    };

    it('ensures proof generated for TESTNET invoice uses testnet explorer URL, never public', () => {
      const result = buildQuittanceProof(mockTestnetInvoice);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.proof.network, 'testnet');
      assert.ok(result.proof.payment.explorerUrl);
      assert.equal(
        result.proof.payment.explorerUrl,
        `https://stellar.expert/explorer/testnet/tx/${'c'.repeat(64)}`
      );
      assert.ok(!result.proof.payment.explorerUrl.includes('/public/'));
    });

    it('ensures proof generated for PUBLIC invoice uses public explorer URL', () => {
      const mockPublicInvoice = {
        ...mockTestnetInvoice,
        id: 'inv-pub-net-1',
        network: 'PUBLIC',
      };
      const result = buildQuittanceProof(mockPublicInvoice);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.proof.network, 'public');
      assert.equal(
        result.proof.payment.explorerUrl,
        `https://stellar.expert/explorer/public/tx/${'c'.repeat(64)}`
      );
    });
  });

  describe('Explorer URL Link Builder', () => {
    it('builds testnet and public explorer URLs correctly', () => {
      const hash = 'd'.repeat(64);
      assert.equal(
        buildHorizonTxUrl(hash, 'testnet'),
        `https://stellar.expert/explorer/testnet/tx/${hash}`
      );
      assert.equal(
        buildHorizonTxUrl(hash, 'public'),
        `https://stellar.expert/explorer/public/tx/${hash}`
      );
    });
  });
});
