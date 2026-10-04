import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Server } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Keypair, Transaction, WebAuth } from '@stellar/stellar-sdk';
import { SellerSessionError, SellerSessionService, sellerSessionsFromEnvironment } from '../src/services/seller-session.service';
import { createInvoiceRouter } from '../src/routes/invoice.routes';
import { corsOptions } from '../src/config/runtime';
import { MemoryStorage } from '../src/storage/memory-storage';
import { MemoryInvoiceStorage } from '../src/storage/memory-invoice-storage';
import { InvoiceMemoryService } from '../src/services/invoice-memory.service';
import { passphraseFor } from '../../shared/network';

const seller = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
const other = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
const serverKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3));
const oldKey = Buffer.alloc(32, 4);
const newKey = Buffer.alloc(32, 5);
const appOrigin = 'https://app.example.invalid';

function authority(overrides: Partial<ConstructorParameters<typeof SellerSessionService>[0]> = {}) {
  return new SellerSessionService({
    signingKey: serverKey, homeDomain: 'example.invalid', webAuthDomain: 'api.example.invalid',
    network: 'TESTNET', activeKeyId: 'old', sessionKeys: new Map([['old', oldKey]]), ...overrides,
  });
}

function sign(transaction: string, key = seller, network: 'TESTNET' | 'PUBLIC' = 'TESTNET') {
  const tx = new Transaction(transaction, passphraseFor(network));
  tx.sign(key);
  return tx.toXDR();
}

function session(service: SellerSessionService, key = seller) {
  const challenge = service.issueChallenge(key.publicKey(), service.network);
  return service.redeemChallenge(sign(challenge.transaction, key, service.network), service.network);
}

function errorCode(code: string, status = 401) {
  return (error: unknown) => error instanceof SellerSessionError && error.code === code && error.status === status;
}

describe('SEP-10 seller sessions', () => {
  it('issues a server-signed, network/domain-bound challenge and a one-hour seller session', () => {
    const service = authority();
    const challenge = service.issueChallenge(seller.publicKey(), 'TESTNET');
    const parsed = WebAuth.readChallengeTx(challenge.transaction, serverKey.publicKey(), passphraseFor('TESTNET'), 'example.invalid', 'api.example.invalid');
    assert.equal(parsed.clientAccountID, seller.publicKey());
    assert.equal(parsed.tx.sequence, '0');
    assert.equal(Number(parsed.tx.timeBounds!.maxTime) - Number(parsed.tx.timeBounds!.minTime), 300);
    assert.equal(challenge.networkPassphrase, passphraseFor('TESTNET'));
    const issued = service.redeemChallenge(sign(challenge.transaction), 'TESTNET');
    assert.deepEqual(service.verifyToken(issued.token), {
      sellerPublicKey: seller.publicKey(), network: 'TESTNET', expiresAt: issued.expiresAt,
    });
    const payload = JSON.parse(Buffer.from(issued.token.split('.')[1], 'base64url').toString());
    assert.equal(payload.exp - payload.iat, 3600);
  });

  it('consumes a nonce once, without consuming it on a bad client signature', () => {
    const service = authority();
    const challenge = service.issueChallenge(seller.publicKey());
    assert.throws(() => service.redeemChallenge(sign(challenge.transaction, other)), errorCode('AUTH_CHALLENGE_SIGNATURE'));
    assert.throws(() => service.redeemChallenge(challenge.transaction), errorCode('AUTH_CHALLENGE_SIGNATURE'));
    const signed = sign(challenge.transaction);
    service.redeemChallenge(signed);
    assert.throws(() => service.redeemChallenge(signed), errorCode('AUTH_CHALLENGE_REUSED'));
  });

  it('rejects a challenge exactly at five minutes, despite the SDK clock grace', () => {
    let now = Date.now();
    const service = authority({ now: () => now });
    const challenge = service.issueChallenge(seller.publicKey());
    now = challenge.expiresAt * 1000;
    assert.throws(() => service.redeemChallenge(sign(challenge.transaction)), errorCode('AUTH_CHALLENGE_EXPIRED'));
  });

  it('rejects other networks, foreign authorities, malformed XDR and invalid accounts', () => {
    const service = authority();
    assert.throws(() => service.issueChallenge(seller.publicKey(), 'PUBLIC'), errorCode('AUTH_NETWORK_MISMATCH', 403));
    assert.throws(() => service.issueChallenge('not-an-account'), errorCode('AUTH_ACCOUNT_INVALID', 400));
    assert.throws(() => service.redeemChallenge('not-xdr'), errorCode('AUTH_CHALLENGE_INVALID'));
    const foreign = authority({ homeDomain: 'other.invalid' }).issueChallenge(seller.publicKey());
    assert.throws(() => service.redeemChallenge(sign(foreign.transaction)), errorCode('AUTH_CHALLENGE_UNKNOWN'));
    const challenge = service.issueChallenge(seller.publicKey());
    assert.throws(() => service.redeemChallenge(sign(challenge.transaction, seller, 'PUBLIC')), errorCode('AUTH_CHALLENGE_SIGNATURE'));
    assert.throws(() => service.redeemChallenge(sign(challenge.transaction), 'PUBLIC'), errorCode('AUTH_NETWORK_MISMATCH', 403));
  });

  it('rejects changed, expired, foreign-network and foreign-domain tokens', () => {
    let now = Date.now();
    const service = authority({ now: () => now });
    const issued = session(service);
    const parts = issued.token.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    parts[1] = Buffer.from(JSON.stringify({ ...payload, sub: other.publicKey() })).toString('base64url');
    assert.throws(() => service.verifyToken(parts.join('.')), errorCode('AUTH_TOKEN_INVALID'));
    assert.throws(() => service.verifyToken(session(authority({ network: 'PUBLIC' })).token), errorCode('AUTH_NETWORK_MISMATCH', 403));
    assert.throws(() => service.verifyToken(session(authority({ homeDomain: 'other.invalid' })).token), errorCode('AUTH_TOKEN_INVALID'));
    now = issued.expiresAt * 1000;
    assert.throws(() => service.verifyToken(issued.token), errorCode('AUTH_SESSION_EXPIRED'));
  });

  it('accepts retained key ids during rotation and rejects a retired key', () => {
    const old = session(authority());
    const rotated = authority({ activeKeyId: 'new', sessionKeys: new Map([['old', oldKey], ['new', newKey]]) });
    assert.equal(rotated.verifyToken(old.token).sellerPublicKey, seller.publicKey());
    const current = session(rotated);
    const newOnly = authority({ activeKeyId: 'new', sessionKeys: new Map([['new', newKey]]) });
    assert.equal(newOnly.verifyToken(current.token).sellerPublicKey, seller.publicKey());
    assert.throws(() => newOnly.verifyToken(old.token), errorCode('AUTH_TOKEN_INVALID'));
  });

  it('bounds nonce memory without evicting a live challenge', () => {
    let now = Date.now();
    const service = authority({ maxChallenges: 1, now: () => now });
    const challenge = service.issueChallenge(seller.publicKey());
    assert.throws(() => service.issueChallenge(other.publicKey()), errorCode('AUTH_CHALLENGE_LIMIT', 429));
    service.redeemChallenge(sign(challenge.transaction));
    now = challenge.expiresAt * 1000;
    assert.ok(service.issueChallenge(other.publicKey()).transaction);
  });

  it('fails closed without configured secrets and accepts an explicit rotating key ring', () => {
    assert.throws(() => sellerSessionsFromEnvironment({ NODE_ENV: 'development', REQUIRE_CANCEL_SIGNATURE: 'false' }), errorCode('AUTH_NOT_CONFIGURED', 503));
    const service = sellerSessionsFromEnvironment({
      SELLER_AUTH_HOME_DOMAIN: 'example.invalid', SELLER_AUTH_WEB_AUTH_DOMAIN: 'api.example.invalid',
      SELLER_AUTH_SIGNING_SECRET: serverKey.secret(), SELLER_SESSION_ACTIVE_KEY_ID: 'old',
      SELLER_SESSION_KEYS: JSON.stringify({ old: oldKey.toString('base64') }), STELLAR_NETWORK: 'TESTNET',
    });
    assert.equal(service.verifyToken(session(service).token).sellerPublicKey, seller.publicKey());
    assert.throws(() => authority({ challengeTtlSeconds: 301 }));
    assert.throws(() => authority({ sessionTtlSeconds: 3601 }));
  });
});

describe('mounted seller authorization', () => {
  let server: Server;
  let base: string;
  let storage: MemoryInvoiceStorage;
  let service: SellerSessionService;
  let ownerToken: string;
  let otherToken: string;

  beforeEach(async () => {
    storage = new MemoryInvoiceStorage(new InvoiceMemoryService(new MemoryStorage()));
    service = authority();
    ownerToken = session(service).token;
    otherToken = session(service, other).token;
    const app = express();
    app.use(cors(corsOptions({ NODE_ENV: 'test', FRONTEND_URL: appOrigin })));
    app.use(express.json({ limit: '32kb' }));
    app.use('/api', createInvoiceRouter({ storage, sellerSessions: service, enableRateLimiting: false, enableConcurrencyLock: false, enableCeilingCheck: false }));
    app.use((error: any, _req: any, res: any, _next: any) => res.status(error.code === 'CORS_ORIGIN_DENIED' ? 403 : 500).json({ success: false }));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  async function request(path: string, token?: string, body?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, body: await response.json() as any };
  }

  function seed() {
    return storage.createInvoice({ sellerPublicKey: seller.publicKey(), amount: 25, assetCode: 'XLM', expiresInDays: 1,
      customerEmail: 'private@example.invalid', customerName: 'Private Customer', sellerEmail: 'owner@example.invalid', metadata: { privateNote: 'internal' } } as any);
  }

  it('exchanges through the mounted endpoints and returns a stable replay error', async () => {
    const challenge = await request(`/auth/challenge?account=${seller.publicKey()}&network=TESTNET`);
    assert.equal(challenge.status, 200);
    assert.equal(challenge.headers.get('cache-control'), 'no-store');
    const signed = sign(challenge.body.data.transaction);
    const result = await request('/auth/session', undefined, { transaction: signed, network: 'TESTNET' });
    assert.equal(result.status, 200);
    assert.equal(result.body.data.sellerPublicKey, seller.publicKey());
    assert.equal((await request('/invoices', result.body.data.token)).status, 200);
    const replay = await request('/auth/session', undefined, { transaction: signed, network: 'TESTNET' });
    assert.equal(replay.status, 401);
    assert.equal(replay.body.code, 'AUTH_CHALLENGE_REUSED');
  });

  it('returns 401 before storage work for every protected route, even with a public key or legacy signature', async () => {
    const routes: [string, unknown?][] = [
      ['/invoices'], ['/invoices/stats'], ['/invoices/known/events'],
      ['/invoices', { sellerPublicKey: seller.publicKey(), amount: 25 }],
      ['/invoices/known/cancel', { sellerPublicKey: seller.publicKey(), signature: seller.sign(Buffer.from('cancel:known')).toString('base64') }],
    ];
    for (const [path, body] of routes) {
      const response = await request(`${path}?sellerPublicKey=${seller.publicKey()}`, undefined, body);
      assert.equal(response.status, 401, path);
      assert.equal(response.body.code, 'AUTH_SESSION_REQUIRED', path);
    }
    assert.equal(await storage.countInvoices!(), 0);
  });

  it('keeps pay-link detail public when its query names the actual seller', async () => {
    const invoice = await seed();
    for (const token of [undefined, otherToken]) {
      const response = await request(`/invoices/${invoice.id}`, token);
      assert.equal(response.status, 200);
      for (const field of ['customerEmail', 'customerName', 'sellerEmail', 'metadata']) assert.equal(response.body.data[field], undefined);
    }
    const forged = await request(`/invoices/${invoice.id}?sellerPublicKey=${seller.publicKey()}`);
    assert.equal(forged.status, 200);
    assert.equal(forged.body.data.customerEmail, undefined);
    assert.doesNotMatch(JSON.stringify(forged.body), /private@example|Private Customer|owner@example|privateNote/);
    const privateResponse = await request(`/invoices/${invoice.id}`, ownerToken);
    assert.equal(privateResponse.body.data.customerEmail, 'private@example.invalid');
    assert.equal(privateResponse.headers.get('cache-control'), 'no-store');
    assert.match(privateResponse.headers.get('vary')!, /Authorization/i);
    assert.equal((await request(`/invoices/${invoice.id}`, 'expired.invalid.token')).status, 401);
  });

  it('derives list, stats and create ownership from the verified session', async () => {
    await seed();
    await storage.createInvoice({ sellerPublicKey: other.publicKey(), amount: 10, expiresInDays: 1 } as any);
    const list = await request('/invoices', ownerToken);
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 1);
    assert.equal(list.body.data[0].sellerPublicKey, seller.publicKey());
    const stats = await request('/invoices/stats', otherToken);
    assert.equal(stats.body.data[0].total_invoices, 1);
    const created = await request('/invoices', ownerToken, { amount: 42, assetCode: 'XLM', expiresInDays: 1 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.invoice.sellerPublicKey, seller.publicKey());
  });

  it('rejects mismatched body, query and header keys with 403', async () => {
    for (const path of ['/invoices', '/invoices/stats', '/invoices/known/events', '/invoices/known']) {
      const response = await request(`${path}?sellerPublicKey=${other.publicKey()}`, ownerToken);
      assert.equal(response.status, 403, path);
      assert.equal(response.body.code, 'AUTH_SELLER_MISMATCH');
    }
    const created = await request('/invoices', ownerToken, { sellerPublicKey: other.publicKey(), amount: 25 });
    assert.equal(created.status, 403);
    const header = await fetch(`${base}/invoices`, { headers: { authorization: `Bearer ${ownerToken}`, 'x-seller-public-key': other.publicKey() } });
    assert.equal(header.status, 403);
    assert.equal(await storage.countInvoices!(), 0);
  });

  it('protects events and cancellation against a different authenticated seller', async () => {
    const invoice = await seed();
    assert.equal((await request(`/invoices/${invoice.id}/events`, otherToken)).status, 403);
    assert.equal((await request(`/invoices/${invoice.id}/cancel`, otherToken, {})).status, 403);
    assert.equal((await storage.getInvoiceById(invoice.id))!.status, 'PENDING');
    assert.equal((await request(`/invoices/${invoice.id}/events`, ownerToken)).status, 200);
    const cancelled = await request(`/invoices/${invoice.id}/cancel`, ownerToken, {});
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.status, 'CANCELLED');
  });

  it('allows Authorization preflight only from the configured frontend origin', async () => {
    const requestHeaders = { 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' };
    const allowed = await fetch(`${base}/invoices`, { method: 'OPTIONS', headers: { origin: appOrigin, ...requestHeaders } });
    assert.equal(allowed.status, 204);
    assert.equal(allowed.headers.get('access-control-allow-origin'), appOrigin);
    assert.match(allowed.headers.get('access-control-allow-headers')!, /Authorization/i);
    const denied = await fetch(`${base}/invoices`, { method: 'OPTIONS', headers: { origin: 'https://foreign.invalid', ...requestHeaders } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  });
});
