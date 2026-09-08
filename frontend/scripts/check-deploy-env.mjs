const required = [
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_STELLAR_NETWORK',
  'NEXT_PUBLIC_HORIZON_URL',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing frontend deploy variables: ${missing.join(', ')}`);
  process.exit(1);
}

const api = new URL(process.env.NEXT_PUBLIC_API_URL);
const app = new URL(process.env.NEXT_PUBLIC_APP_URL);
const horizon = new URL(process.env.NEXT_PUBLIC_HORIZON_URL);

if (api.protocol !== 'https:' || !api.pathname.replace(/\/$/, '').endsWith('/api')) {
  throw new Error('NEXT_PUBLIC_API_URL must use HTTPS and end with /api');
}
if (app.protocol !== 'https:' || horizon.protocol !== 'https:') {
  throw new Error('Production app and Horizon URLs must use HTTPS');
}
if (!['TESTNET', 'PUBLIC'].includes(process.env.NEXT_PUBLIC_STELLAR_NETWORK)) {
  throw new Error('NEXT_PUBLIC_STELLAR_NETWORK must be TESTNET or PUBLIC');
}
if (process.env.NEXT_PUBLIC_USE_MOCK === 'true') {
  throw new Error('NEXT_PUBLIC_USE_MOCK must be false in production');
}

console.log(`Frontend deploy env OK: ${app.origin} -> ${api.toString()}`);
