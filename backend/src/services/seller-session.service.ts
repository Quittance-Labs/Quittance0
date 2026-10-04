import { createHmac, timingSafeEqual } from 'node:crypto';
import { Keypair, StrKey, Transaction, WebAuth } from '@stellar/stellar-sdk';
import {
  passphraseFor,
  resolveStellarNetwork,
  type StellarNetwork,
} from '../../../shared/network';

const CHALLENGE_TTL_SECONDS = 300;
const SESSION_TTL_SECONDS = 3600;

export class SellerSessionError extends Error {
  constructor(readonly code: string, message: string, readonly status = 401) {
    super(message);
    this.name = 'SellerSessionError';
  }
}

export interface SellerSession {
  sellerPublicKey: string;
  network: StellarNetwork;
  expiresAt: number;
}

export interface SellerSessionOptions {
  signingKey: Keypair;
  homeDomain: string;
  webAuthDomain?: string;
  network: StellarNetwork;
  activeKeyId: string;
  sessionKeys: ReadonlyMap<string, Buffer>;
  challengeTtlSeconds?: number;
  sessionTtlSeconds?: number;
  maxChallenges?: number;
  now?: () => number;
}

interface ChallengeRecord {
  account: string;
  expiresAt: number;
  redeemed: boolean;
}

function invalid(code = 'AUTH_TOKEN_INVALID', message = 'Seller session is invalid'): never {
  throw new SellerSessionError(code, message);
}

function domain(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 59 ||
      !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?(?::[0-9]{1,5})?$/.test(value)) {
    throw new Error('Seller authentication domains must be host names, optionally with a port');
  }
  return value.toLowerCase();
}

function boundedSeconds(value: number | undefined, maximum: number): number {
  const result = value ?? maximum;
  if (!Number.isInteger(result) || result < 1 || result > maximum) {
    throw new Error('Invalid seller authentication lifetime');
  }
  return result;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decode(value: string): any {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) invalid();
  try {
    const result = JSON.parse(bytes.toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) invalid();
    return result;
  } catch {
    return invalid();
  }
}

/**
 * SEP-10 challenges prove possession of the exact Freighter account key.
 * Challenges never submit a transaction or require a funded account.
 * Redemption is synchronous through nonce consumption, preventing two requests
 * in this process from exchanging the same challenge for separate sessions.
 */
export class SellerSessionService {
  readonly network: StellarNetwork;
  readonly networkPassphrase: string;
  readonly homeDomain: string;
  readonly webAuthDomain: string;
  private readonly signingKey: Keypair;
  private readonly activeKeyId: string;
  private readonly keys: Map<string, Buffer>;
  private readonly challengeTtlSeconds: number;
  private readonly sessionTtlSeconds: number;
  private readonly maxChallenges: number;
  private readonly now: () => number;
  private readonly challenges = new Map<string, ChallengeRecord>();

  constructor(options: SellerSessionOptions) {
    this.network = resolveStellarNetwork(options.network);
    this.networkPassphrase = passphraseFor(this.network);
    this.homeDomain = domain(options.homeDomain);
    this.webAuthDomain = domain(options.webAuthDomain ?? options.homeDomain);
    if (!options.signingKey.canSign()) throw new Error('Seller auth signing key must sign');
    this.signingKey = options.signingKey;
    this.activeKeyId = options.activeKeyId;
    this.keys = new Map();
    for (const [kid, key] of options.sessionKeys) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(kid) || !Buffer.isBuffer(key) || key.length < 32) {
        throw new Error('Seller session keys require a key id and at least 32 random bytes');
      }
      this.keys.set(kid, Buffer.from(key));
    }
    if (!this.keys.has(this.activeKeyId)) throw new Error('Active seller session key is missing');
    this.challengeTtlSeconds = boundedSeconds(options.challengeTtlSeconds, CHALLENGE_TTL_SECONDS);
    this.sessionTtlSeconds = boundedSeconds(options.sessionTtlSeconds, SESSION_TTL_SECONDS);
    this.maxChallenges = options.maxChallenges ?? 10_000;
    if (!Number.isSafeInteger(this.maxChallenges) || this.maxChallenges < 1) {
      throw new Error('Invalid seller challenge capacity');
    }
    this.now = options.now ?? Date.now;
  }

  private requireNetwork(network: unknown): void {
    if (network !== undefined && network !== this.network) {
      throw new SellerSessionError('AUTH_NETWORK_MISMATCH', 'Seller session network does not match the API network', 403);
    }
  }

  issueChallenge(account: unknown, network?: unknown) {
    this.requireNetwork(network);
    if (typeof account !== 'string' || !StrKey.isValidEd25519PublicKey(account) ||
        account === this.signingKey.publicKey()) {
      throw new SellerSessionError('AUTH_ACCOUNT_INVALID', 'A valid seller account is required', 400);
    }
    const now = Math.floor(this.now() / 1000);
    for (const [hash, record] of this.challenges) {
      if (record.expiresAt <= now) this.challenges.delete(hash);
    }
    if (this.challenges.size >= this.maxChallenges) {
      throw new SellerSessionError('AUTH_CHALLENGE_LIMIT', 'Challenge capacity reached; retry after expiry', 429);
    }
    const transaction = WebAuth.buildChallengeTx(
      this.signingKey, account, this.homeDomain, this.challengeTtlSeconds,
      this.networkPassphrase, this.webAuthDomain,
    );
    const tx = new Transaction(transaction, this.networkPassphrase);
    const expiresAt = Number(tx.timeBounds!.maxTime);
    this.challenges.set(tx.hash().toString('hex'), { account, expiresAt, redeemed: false });
    return {
      transaction,
      network: this.network,
      networkPassphrase: this.networkPassphrase,
      serverSigningKey: this.signingKey.publicKey(),
      homeDomain: this.homeDomain,
      webAuthDomain: this.webAuthDomain,
      expiresAt,
    };
  }

  redeemChallenge(transaction: unknown, network?: unknown): SellerSession & { token: string } {
    this.requireNetwork(network);
    if (typeof transaction !== 'string' || transaction.length === 0 || transaction.length > 16_384) {
      throw new SellerSessionError('AUTH_CHALLENGE_INVALID', 'A signed challenge transaction is required', 400);
    }
    let tx: Transaction;
    try {
      tx = new Transaction(transaction, this.networkPassphrase);
    } catch {
      return invalid('AUTH_CHALLENGE_INVALID', 'Challenge transaction is invalid');
    }
    const record = this.challenges.get(tx.hash().toString('hex'));
    if (!record) invalid('AUTH_CHALLENGE_UNKNOWN', 'Challenge was not issued by this session authority');
    const now = Math.floor(this.now() / 1000);
    // The SDK permits clock grace; the issued nonce deadline remains strict.
    if (now >= record.expiresAt) invalid('AUTH_CHALLENGE_EXPIRED', 'Challenge has expired');
    if (record.redeemed) invalid('AUTH_CHALLENGE_REUSED', 'Challenge has already been redeemed');
    try {
      const read = WebAuth.readChallengeTx(
        transaction, this.signingKey.publicKey(), this.networkPassphrase,
        this.homeDomain, this.webAuthDomain,
      );
      if (read.clientAccountID !== record.account || read.memo !== null ||
          Number(read.tx.timeBounds?.maxTime) !== record.expiresAt) {
        invalid('AUTH_CHALLENGE_INVALID', 'Challenge contents do not match the issued request');
      }
      const signers = WebAuth.verifyChallengeTxSigners(
        transaction, this.signingKey.publicKey(), this.networkPassphrase,
        [record.account], this.homeDomain, this.webAuthDomain,
      );
      if (signers.length !== 1 || signers[0] !== record.account) {
        invalid('AUTH_CHALLENGE_SIGNATURE', 'Challenge must be signed by its seller');
      }
    } catch (error) {
      if (error instanceof SellerSessionError) throw error;
      return invalid('AUTH_CHALLENGE_SIGNATURE', 'Challenge signature or binding is invalid');
    }
    record.redeemed = true;
    const expiresAt = now + this.sessionTtlSeconds;
    const header = encode({ alg: 'HS256', typ: 'JWT', kid: this.activeKeyId });
    const payload = encode({
      v: 1, sub: record.account, network: this.network,
      aud: this.homeDomain, iss: this.webAuthDomain, iat: now, exp: expiresAt,
    });
    const input = `${header}.${payload}`;
    const signature = createHmac('sha256', this.keys.get(this.activeKeyId)!).update(input).digest('base64url');
    return { token: `${input}.${signature}`, sellerPublicKey: record.account, network: this.network, expiresAt };
  }

  verifyToken(token: unknown): SellerSession {
    if (typeof token !== 'string' || token.length > 4096) invalid();
    const parts = token.split('.');
    if (parts.length !== 3) invalid();
    const [headerPart, payloadPart, signaturePart] = parts;
    const header = decode(headerPart);
    if (header.alg !== 'HS256' || header.typ !== 'JWT' || typeof header.kid !== 'string') invalid();
    const key = this.keys.get(header.kid);
    if (!key || !/^[A-Za-z0-9_-]{43}$/.test(signaturePart)) invalid();
    const actual = Buffer.from(signaturePart, 'base64url');
    const expected = createHmac('sha256', key).update(`${headerPart}.${payloadPart}`).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected) ||
        actual.toString('base64url') !== signaturePart) invalid();
    const payload = decode(payloadPart);
    if (payload.network !== this.network) {
      throw new SellerSessionError('AUTH_NETWORK_MISMATCH', 'Seller session belongs to another network', 403);
    }
    const now = Math.floor(this.now() / 1000);
    if (payload.v !== 1 || typeof payload.sub !== 'string' ||
        !StrKey.isValidEd25519PublicKey(payload.sub) || payload.aud !== this.homeDomain ||
        payload.iss !== this.webAuthDomain || !Number.isSafeInteger(payload.iat) ||
        !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat ||
        payload.exp - payload.iat > SESSION_TTL_SECONDS || payload.iat > now) invalid();
    if (payload.exp <= now) invalid('AUTH_SESSION_EXPIRED', 'Seller session has expired');
    return { sellerPublicKey: payload.sub, network: this.network, expiresAt: payload.exp };
  }
}

/** No development bypass or payment-key fallback: unconfigured auth fails closed. */
export function sellerSessionsFromEnvironment(env: Record<string, string | undefined> = process.env): SellerSessionService {
  try {
    if (!env.SELLER_AUTH_HOME_DOMAIN || !env.SELLER_AUTH_SIGNING_SECRET ||
        !env.SELLER_SESSION_KEYS || !env.SELLER_SESSION_ACTIVE_KEY_ID) throw new Error('Missing configuration');
    const raw = JSON.parse(env.SELLER_SESSION_KEYS);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid keys');
    const keys = new Map<string, Buffer>();
    for (const [kid, encoded] of Object.entries(raw)) {
      if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid key encoding');
      const key = Buffer.from(encoded, 'base64');
      if (key.toString('base64') !== encoded) throw new Error('Noncanonical key encoding');
      keys.set(kid, key);
    }
    return new SellerSessionService({
      signingKey: Keypair.fromSecret(env.SELLER_AUTH_SIGNING_SECRET),
      homeDomain: env.SELLER_AUTH_HOME_DOMAIN,
      webAuthDomain: env.SELLER_AUTH_WEB_AUTH_DOMAIN,
      network: resolveStellarNetwork(env.STELLAR_NETWORK),
      activeKeyId: env.SELLER_SESSION_ACTIVE_KEY_ID,
      sessionKeys: keys,
    });
  } catch {
    throw new SellerSessionError('AUTH_NOT_CONFIGURED', 'Seller authentication is not configured', 503);
  }
}
