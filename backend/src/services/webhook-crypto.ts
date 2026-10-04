import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export interface WebhookSecrets {
  secretHash: string;
  secretEncrypted: string;
  previousSecretHash?: string;
  previousSecretEncrypted?: string;
  previousSecretExpiresAt?: string;
}

const SECRET_AAD = Buffer.from('quittance-webhook-secret-v1', 'utf8');

export function webhookEncryptionKey(
  value: string | undefined = process.env.WEBHOOK_ENCRYPTION_KEY
): Buffer {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('WEBHOOK_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters');
  }
  return Buffer.from(value, 'hex');
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('Webhook encryption requires a 32-byte key');
  }
}

function secretHash(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

export function sealWebhookSecret(secret: string, key: Buffer): WebhookSecrets {
  assertKey(key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(SECRET_AAD);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return {
    secretHash: secretHash(secret),
    secretEncrypted: [
      'v1',
      iv.toString('base64'),
      cipher.getAuthTag().toString('base64'),
      ciphertext.toString('base64'),
    ].join('.'),
  };
}

export function newWebhookSecret(key: Buffer): WebhookSecrets & { secret: string } {
  const secret = 'whsec_' + randomBytes(32).toString('base64url');
  return { ...sealWebhookSecret(secret, key), secret };
}

export function openWebhookSecret(
  encrypted: string,
  expectedHash: string,
  key: Buffer
): string {
  assertKey(key);
  try {
    if (encrypted.length > 8192 || !/^[a-fA-F0-9]{64}$/.test(expectedHash)) {
      throw new Error('Invalid signing secret');
    }
    const parts = encrypted.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Invalid signing secret');
    }
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error('Invalid signing secret');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(SECRET_AAD);
    decipher.setAuthTag(tag);
    const secret = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const actualHash = Buffer.from(secretHash(secret), 'hex');
    if (!timingSafeEqual(actualHash, Buffer.from(expectedHash, 'hex'))) {
      throw new Error('Invalid signing secret');
    }
    return secret;
  } catch {
    throw new Error('Invalid webhook signing secret');
  }
}

export function webhookSignature(
  secret: string,
  timestamp: number,
  body: string | Buffer
): string {
  return createHmac('sha256', secret)
    .update(String(timestamp) + '.', 'utf8')
    .update(body)
    .digest('hex');
}

export function webhookSignatureHeader(
  secrets: WebhookSecrets,
  key: Buffer,
  timestamp: number,
  body: string | Buffer
): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error('Invalid webhook timestamp');
  }
  const current = openWebhookSecret(secrets.secretEncrypted, secrets.secretHash, key);
  const signatures = ['t=' + timestamp, 'v1=' + webhookSignature(current, timestamp, body)];
  if (
    secrets.previousSecretEncrypted &&
    secrets.previousSecretHash &&
    secrets.previousSecretExpiresAt &&
    Date.parse(secrets.previousSecretExpiresAt) > timestamp * 1000
  ) {
    const previous = openWebhookSecret(
      secrets.previousSecretEncrypted,
      secrets.previousSecretHash,
      key
    );
    signatures.push('v1=' + webhookSignature(previous, timestamp, body));
  }
  return signatures.join(',');
}

/** Verify the original request bytes before parsing JSON or processing an event. */
export function verifyWebhookSignature(
  secret: string,
  header: string,
  rawBody: string | Buffer,
  nowMs: number = Date.now()
): boolean {
  if (typeof header !== 'string' || header.length > 1024 || !Number.isFinite(nowMs)) {
    return false;
  }
  let rawTimestamp: string | undefined;
  const candidates: Buffer[] = [];
  for (const part of header.split(',')) {
    const entry = part.trim();
    if (entry.startsWith('t=')) {
      if (rawTimestamp !== undefined || !/^t=[0-9]{1,12}$/.test(entry)) return false;
      rawTimestamp = entry.slice(2);
    } else if (/^v1=[a-fA-F0-9]{64}$/.test(entry)) {
      candidates.push(Buffer.from(entry.slice(3), 'hex'));
    } else {
      return false;
    }
  }
  if (rawTimestamp === undefined || candidates.length === 0) return false;
  const timestamp = Number(rawTimestamp);
  if (
    !Number.isSafeInteger(timestamp) ||
    String(timestamp) !== rawTimestamp ||
    Math.abs(nowMs - timestamp * 1000) >= 300_000
  ) {
    return false;
  }
  const expected = Buffer.from(webhookSignature(secret, timestamp, rawBody), 'hex');
  let matches = false;
  for (const candidate of candidates) {
    matches = timingSafeEqual(expected, candidate) || matches;
  }
  return matches;
}
