const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const esbuild = require('esbuild');
const { Keypair, Networks, Transaction, WebAuth } = require('@stellar/stellar-sdk');

const ROOT = path.resolve(__dirname, '..');
const seller = Keypair.random();
const other = Keypair.random();
const serverKey = Keypair.random();
let app;

test.before(async () => {
  const result = await esbuild.build({
    stdin: {
      contents: `export { signSellerChallenge, server } from './lib/stellar';
        export { mockAuthApi, mockInvoiceApi } from './lib/mock-api';
        export { setWallet, setSigner, getCalls } from '@stellar/freighter-api';`,
      resolveDir: ROOT, sourcefile: 'seller-challenge-test.ts', loader: 'ts',
    },
    absWorkingDir: ROOT, bundle: true, write: false, platform: 'node', format: 'cjs',
    external: ['@stellar/stellar-sdk', 'zustand', 'zustand/middleware'], tsconfig: 'tsconfig.json',
    define: { 'process.env.NEXT_PUBLIC_STELLAR_NETWORK': '"TESTNET"' },
    plugins: [{
      name: 'freighter-extension-boundary',
      setup(build) {
        build.onResolve({ filter: /^@stellar\/freighter-api$/ }, () => ({ path: 'freighter', namespace: 'wallet-test' }));
        build.onLoad({ filter: /.*/, namespace: 'wallet-test' }, () => ({
          contents: `let wallet; let signer; let calls = [];
            export const setWallet = (next) => { wallet = next; };
            export const setSigner = (next) => { signer = next; calls = []; };
            export const getCalls = () => calls;
            export const isConnected = async () => true;
            export const isAllowed = async () => true;
            export const setAllowed = async () => true;
            export const getPublicKey = async () => wallet;
            export const getAddress = async () => ({ address: wallet });
            export const WatchWalletChanges = undefined;
            export const getNetwork = async () => ({ network: 'TESTNET', networkPassphrase: 'Test SDF Network ; September 2015' });
            export const getNetworkDetails = getNetwork;
            export const signTransaction = async (xdr, options) => {
              calls.push({ xdr, options }); return signer(xdr, options);
            };`, loader: 'js',
        }));
      },
    }],
  });
  const compiled = new Module('seller-challenge-test');
  compiled.filename = path.join(ROOT, 'seller-challenge-test.cjs');
  compiled.paths = Module._nodeModulePaths(ROOT);
  compiled._compile(result.outputFiles[0].text, compiled.filename);
  app = compiled.exports;
  app.server.submitTransaction = async () => { throw new Error('An authentication challenge must never be submitted'); };
});

function challengeFor(account = seller.publicKey()) {
  const transaction = WebAuth.buildChallengeTx(serverKey, account, 'quittance.test', 300,
    Networks.TESTNET, 'api.quittance.test');
  return {
    transaction, network: 'TESTNET', networkPassphrase: Networks.TESTNET,
    serverSigningKey: serverKey.publicKey(), homeDomain: 'quittance.test',
    webAuthDomain: 'api.quittance.test',
    expiresAt: Number(new Transaction(transaction, Networks.TESTNET).timeBounds.maxTime),
  };
}

function sign(xdr, account = seller) {
  const transaction = new Transaction(xdr, Networks.TESTNET);
  transaction.sign(account);
  return transaction.toXDR();
}

test('Freighter signs the exact SEP-10 transaction for the pinned account and network', async () => {
  const challenge = challengeFor();
  app.setWallet(seller.publicKey());
  app.setSigner((xdr) => sign(xdr));
  const signed = await app.signSellerChallenge(challenge, seller.publicKey());
  assert.deepEqual(app.getCalls(), [{ xdr: challenge.transaction, options: {
    networkPassphrase: Networks.TESTNET, accountToSign: seller.publicKey(),
  } }]);
  assert.deepEqual(WebAuth.verifyChallengeTxSigners(signed, serverKey.publicKey(), Networks.TESTNET,
    [seller.publicKey()], 'quittance.test', 'api.quittance.test'), [seller.publicKey()]);
});

test('wrong-network, expired and different-account challenges never open Freighter signing', async () => {
  app.setWallet(seller.publicKey());
  app.setSigner((xdr) => sign(xdr));
  const challenge = challengeFor();
  await assert.rejects(app.signSellerChallenge({ ...challenge, network: 'PUBLIC' }, seller.publicKey()),
    { code: 'AUTH_NETWORK_MISMATCH' });
  await assert.rejects(app.signSellerChallenge({ ...challenge, expiresAt: 1 }, seller.publicKey()),
    { code: 'AUTH_INVALID_CHALLENGE' });
  await assert.rejects(app.signSellerChallenge(challengeFor(other.publicKey()), seller.publicKey()),
    { code: 'AUTH_INVALID_CHALLENGE' });
  assert.equal(app.getCalls().length, 0);
});

test('a wallet switch inside the signing dialog rejects the old account signature', async () => {
  app.setWallet(seller.publicKey());
  app.setSigner((xdr) => {
    app.setWallet(other.publicKey());
    return sign(xdr);
  });
  await assert.rejects(app.signSellerChallenge(challengeFor(), seller.publicKey()),
    { code: 'WALLET_SESSION_CHANGED' });
});

test('a disconnected wallet or declined dialog is an authentication error, not an API outage', async () => {
  app.setWallet(null);
  app.setSigner((xdr) => sign(xdr));
  await assert.rejects(app.signSellerChallenge(challengeFor(), seller.publicKey()),
    { code: 'AUTH_WALLET_REQUIRED' });
  app.setWallet(seller.publicKey());
  app.setSigner(() => { throw new Error('User declined'); });
  await assert.rejects(app.signSellerChallenge(challengeFor(), seller.publicKey()),
    { code: 'AUTH_SIGNATURE_REQUIRED' });
});

test('the mock accepts a signed challenge once and public pay-link data omits customer email', async () => {
  const { data } = await app.mockAuthApi.getChallenge(seller.publicKey(), 'TESTNET');
  const transaction = sign(data.transaction);
  const result = await app.mockAuthApi.createSession({ transaction, network: 'TESTNET' });
  assert.equal(result.data.sellerPublicKey, seller.publicKey());
  assert.equal(result.data.network, 'TESTNET');
  await assert.rejects(app.mockAuthApi.createSession({ transaction, network: 'TESTNET' }),
    { code: 'AUTH_CHALLENGE_REPLAYED' });
  const invoice = await app.mockInvoiceApi.getById('1');
  assert.equal('customerEmail' in invoice.data, false);
  assert.equal('payerPublicKey' in invoice.data, false);
});
