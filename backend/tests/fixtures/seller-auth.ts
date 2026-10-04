import { createHmac } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';

// Test-only server credentials. Older payment/storage fixtures intentionally
// retain their public account ids; they test behavior after authentication.
// seller-session.test.ts separately proves the real SEP-10 exchange/signatures.
const key = Buffer.alloc(32, 87);
const domain = 'fixture.example.invalid';
export const sellerAuthEnvironment = {
  SELLER_AUTH_HOME_DOMAIN: domain,
  SELLER_AUTH_SIGNING_SECRET: Keypair.fromRawEd25519Seed(Buffer.alloc(32, 88)).secret(),
  SELLER_SESSION_ACTIVE_KEY_ID: 'fixture',
  SELLER_SESSION_KEYS: JSON.stringify({ fixture: key.toString('base64') }),
};

export function sellerSessionLocals(sellerPublicKey?: string) {
  return sellerPublicKey ? {
    sellerSession: { sellerPublicKey, network: 'TESTNET', expiresAt: Math.floor(Date.now() / 1000) + 3600 },
  } : {};
}

/** Server-signed fixture token for HTTP suites whose subject is not login. */
export function sellerAuthHeaders(sellerPublicKey: string): Record<string, string> {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT', kid: 'fixture' });
  const payload = encode({ v: 1, sub: sellerPublicKey, network: 'TESTNET', aud: domain, iss: domain, iat: now, exp: now + 3600 });
  const input = `${header}.${payload}`;
  return { authorization: `Bearer ${input}.${createHmac('sha256', key).update(input).digest('base64url')}` };
}
