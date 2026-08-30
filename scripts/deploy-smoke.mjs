const configured = process.env.DEPLOY_API_URL || process.argv[2];
if (!configured) {
  console.error('Usage: DEPLOY_API_URL=https://your-api.example/api node scripts/deploy-smoke.mjs');
  process.exit(1);
}

const baseUrl = configured.replace(/\/+$/, '');
const sellerPublicKey = 'G' + 'A'.repeat(55);

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(20_000),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    ...options,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

const health = await request('/health');
if (health.status !== 'ok') throw new Error('Health endpoint did not return status=ok');

const readiness = await request('/ready');
if (readiness.status !== 'ready' || readiness.ready !== true) {
  throw new Error('Readiness endpoint did not confirm ready=true');
}

const created = await request('/invoices', {
  method: 'POST',
  body: JSON.stringify({
    amount: 0.0000001,
    assetCode: 'XLM',
    description: `Deploy smoke ${new Date().toISOString()}`,
    sellerPublicKey,
  }),
});
const invoice = created?.data?.invoice;
if (!invoice?.id || invoice.status !== 'PENDING') throw new Error('Create invoice contract failed');

const fetched = await request(`/invoices/${invoice.id}`);
if (fetched?.data?.id !== invoice.id) throw new Error('Created invoice could not be read back');

console.log(`Deploy smoke passed: ${baseUrl} (${invoice.id})`);
