import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { BlockList, isIP } from 'node:net';

export type WebhookTransportErrorCode =
  | 'UNSAFE_URL'
  | 'UNSAFE_ADDRESS'
  | 'DNS_FAILED'
  | 'TIMEOUT'
  | 'TRANSPORT_FAILED';

export class WebhookTransportError extends Error {
  constructor(public readonly code: WebhookTransportErrorCode) {
    super('Webhook transport failed: ' + code);
    this.name = 'WebhookTransportError';
  }
}

export type WebhookResolver = (
  hostname: string
) => Promise<readonly { address: string; family: number }[]>;

export type WebhookTransport = (
  url: string,
  body: string,
  headers: Record<string, string>
) => Promise<{ statusCode: number }>;

const deniedAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  deniedAddresses.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 96],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  deniedAddresses.addSubnet(address, prefix, 'ipv6');
}
const publicV6Addresses = new BlockList();
publicV6Addresses.addSubnet('2000::', 3, 'ipv6');
publicV6Addresses.addSubnet('::ffff:0:0', 96, 'ipv6');

/** Node's BlockList also applies the IPv4 rules to IPv4-mapped IPv6 addresses. */
export function isPublicWebhookAddress(address: string): boolean {
  if (address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !deniedAddresses.check(address, 'ipv4');
  if (family !== 6) return false;
  return publicV6Addresses.check(address, 'ipv6') &&
    !deniedAddresses.check(address, 'ipv6');
}

const defaultResolver: WebhookResolver = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export async function validateWebhookUrl(
  raw: string,
  resolve: WebhookResolver = defaultResolver
): Promise<{ url: URL; address: string; family: number }> {
  let url: URL;
  try {
    if (typeof raw !== 'string' || raw.length > 2048 || raw !== raw.trim()) {
      throw new Error('Invalid URL');
    }
    url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error('Invalid URL');
    }
  } catch {
    throw new WebhookTransportError('UNSAFE_URL');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(hostname);
  let addresses: readonly { address: string; family: number }[];
  if (literalFamily) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      addresses = await Promise.race([
        resolve(hostname),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new WebhookTransportError('DNS_FAILED')), 2000);
        }),
      ]);
    } catch {
      throw new WebhookTransportError('DNS_FAILED');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new WebhookTransportError('DNS_FAILED');
  }
  for (const entry of addresses) {
    if (
      (entry.family !== 4 && entry.family !== 6) ||
      isIP(entry.address) !== entry.family ||
      !isPublicWebhookAddress(entry.address)
    ) {
      throw new WebhookTransportError('UNSAFE_ADDRESS');
    }
  }
  return { url, address: addresses[0].address, family: addresses[0].family };
}

export function createWebhookTransport(
  options: { resolve?: WebhookResolver; timeoutMs?: number } = {}
): WebhookTransport {
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Webhook transport timeout must be positive');
  }

  return async (rawUrl, body, headers) => {
    // Resolve again at send time and pin this result through the connection.
    const { url, address, family } = await validateWebhookUrl(rawUrl, options.resolve);
    const pinnedLookup: NonNullable<RequestOptions['lookup']> = (_hostname, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [{ address, family }]);
      else callback(null, address, family);
    };
    return new Promise<{ statusCode: number }>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: WebhookTransportError, statusCode?: number) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve({ statusCode: statusCode ?? 0 });
      };

      const request = httpsRequest(url, {
        method: 'POST',
        agent: false,
        lookup: pinnedLookup,
        maxHeaderSize: 16 * 1024,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(body, 'utf8')),
          Connection: 'close',
        },
      }, (response) => {
        // Native HTTPS does not follow redirects. Read and discard the response
        // without retaining or logging potentially sensitive receiver content.
        response.once('error', () => {
          request.destroy();
          finish(new WebhookTransportError('TRANSPORT_FAILED'));
        });
        response.once('aborted', () => {
          request.destroy();
          finish(new WebhookTransportError('TRANSPORT_FAILED'));
        });
        response.once('end', () => finish(undefined, response.statusCode ?? 0));
        response.resume();
      });

      request.once('error', (error) => {
        finish(error instanceof WebhookTransportError
          ? error
          : new WebhookTransportError('TRANSPORT_FAILED'));
      });
      const timeout = () => {
        const error = new WebhookTransportError('TIMEOUT');
        request.destroy(error);
        finish(error);
      };
      request.setTimeout(timeoutMs, timeout);
      // A wall-clock limit also stops a receiver that keeps trickling bytes.
      timer = setTimeout(timeout, timeoutMs);
      request.end(body);
    });
  };
}
