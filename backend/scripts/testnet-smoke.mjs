import * as StellarSdk from '@stellar/stellar-sdk';

export const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org';
export const DEFAULT_TESTNET_SELLER = 'GB3Q3VRHH3OQDYITTLONDLEHWQGKB27T2BEDSFHIUMOERULVXPDXRKG4';
export const DEFAULT_API_URL = 'http://127.0.0.1:3001';

/**
 * Normalizes an API base URL by ensuring a protocol and stripping trailing slashes or duplicate /api prefixes.
 *
 * @param {string} raw - Raw API URL from configuration or environment.
 * @returns {string} Normalized base URL without trailing slash or trailing /api.
 */
export function normalizeApiUrl(raw) {
  let url = String(raw || DEFAULT_API_URL).trim().replace(/\/+$/, '');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'http://' + url;
  }
  if (url.endsWith('/api')) {
    url = url.slice(0, -4);
  }
  return url;
}

/**
 * Parses CLI flags and environment variables into a structured configuration object.
 *
 * @param {string[]} argv - Command-line argument vector.
 * @param {Record<string, string | undefined>} env - Environment variables map.
 * @returns {Record<string, any>} Smoke test configuration.
 */
export function parseConfig(argv = process.argv.slice(2), env = process.env) {
  let apiUrl = env.SMOKE_API_URL || env.API_URL || DEFAULT_API_URL;
  let sellerPublicKey = env.SMOKE_SELLER_PUBLIC_KEY || env.SELLER_PUBLIC_KEY || DEFAULT_TESTNET_SELLER;
  let payerSecret = env.SMOKE_PAYER_SECRET || env.PAYER_SECRET || '';
  let fixtureTxHash = env.SMOKE_FIXTURE_TX_HASH || env.FIXTURE_TX_HASH || '';
  let horizonUrl = env.STELLAR_HORIZON_URL || env.SMOKE_HORIZON_URL || DEFAULT_HORIZON_URL;
  let amount = env.SMOKE_AMOUNT || env.AMOUNT || '1';
  let simulate = env.SMOKE_SIMULATE === 'true' || env.ALLOW_SIMULATE === 'true';
  let showHelp = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--api-url' && argv[i + 1]) {
      apiUrl = argv[++i];
    } else if (arg === '--seller' && argv[i + 1]) {
      sellerPublicKey = argv[++i];
    } else if (arg === '--payer-secret' && argv[i + 1]) {
      payerSecret = argv[++i];
    } else if (arg === '--fixture-tx-hash' && argv[i + 1]) {
      fixtureTxHash = argv[++i];
    } else if (arg === '--horizon-url' && argv[i + 1]) {
      horizonUrl = argv[++i];
    } else if (arg === '--amount' && argv[i + 1]) {
      amount = argv[++i];
    } else if (arg === '--simulate') {
      simulate = true;
    }
  }

  return {
    apiUrl: normalizeApiUrl(apiUrl),
    sellerPublicKey,
    payerSecret,
    fixtureTxHash,
    horizonUrl,
    amount,
    simulate,
    showHelp,
  };
}

/**
 * Executes an HTTP JSON request against the API server.
 *
 * @param {string} baseUrl - Normalized API host root.
 * @param {string} endpointPath - Endpoint path (e.g. '/api/health').
 * @param {RequestInit & { timeoutMs?: number }} options - Fetch options.
 * @returns {Promise<{ status: number; ok: boolean; body: any }>} Response payload.
 */
export async function makeRequest(baseUrl, endpointPath, options = {}) {
  const timeoutMs = options.timeoutMs || 25_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `${baseUrl}${endpointPath}`;
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...options.headers,
      },
    });

    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }

    return {
      status: response.status,
      ok: response.ok,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Submits a native XLM payment transaction to the Stellar Testnet.
 *
 * @param {object} params - Payment details.
 * @param {string} params.horizonUrl - Stellar Horizon URL.
 * @param {string} params.payerSecret - Payer account secret key.
 * @param {string} params.destinationPublicKey - Recipient seller public key.
 * @param {string} params.amount - XLM amount.
 * @param {string} params.memo - Invoice memo.
 * @returns {Promise<string>} Submitted transaction hash.
 */
export async function submitTestnetPayment({ horizonUrl, payerSecret, destinationPublicKey, amount, memo }) {
  const payerKeypair = StellarSdk.Keypair.fromSecret(payerSecret);
  const horizon = new StellarSdk.Horizon.Server(horizonUrl);

  const payerAccount = await horizon.loadAccount(payerKeypair.publicKey());
  const transaction = new StellarSdk.TransactionBuilder(payerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: destinationPublicKey,
        asset: StellarSdk.Asset.native(),
        amount: String(amount),
      })
    )
    .addMemo(StellarSdk.Memo.text(memo))
    .setTimeout(180)
    .build();

  transaction.sign(payerKeypair);
  const result = await horizon.submitTransaction(transaction);
  return result.hash;
}

/**
 * Executes the complete end-to-end smoke test workflow.
 *
 * @param {Record<string, any>} options - Override configuration options.
 * @returns {Promise<Record<string, any>>} Summary of the completed smoke test.
 */
export async function runSmokeTest(options = {}) {
  const config = {
    ...parseConfig([], {}),
    ...options,
  };

  const { apiUrl, sellerPublicKey, payerSecret, fixtureTxHash, horizonUrl, amount, simulate } = config;

  if (!payerSecret && !fixtureTxHash && !simulate) {
    throw new Error(
      'No payment execution method provided. Supply SMOKE_PAYER_SECRET, SMOKE_FIXTURE_TX_HASH, or pass --simulate.'
    );
  }

  const healthRes = await makeRequest(apiUrl, '/api/health');
  if (healthRes.status !== 200 || !healthRes.body || healthRes.body.status !== 'ok') {
    throw new Error(`API health check failed: status ${healthRes.status} ${JSON.stringify(healthRes.body)}`);
  }

  const readyRes = await makeRequest(apiUrl, '/api/ready');
  if (readyRes.status !== 200 || !readyRes.body || (readyRes.body.ready !== true && readyRes.body.status !== 'ready')) {
    const isSimulateOnlyReason =
      readyRes.body?.reasons?.length === 1 &&
      readyRes.body.reasons[0] === 'ALLOW_SIMULATE must be false in deploy environments';
    if (!isSimulateOnlyReason) {
      throw new Error(`API readiness check failed: status ${readyRes.status} ${JSON.stringify(readyRes.body)}`);
    }
  }

  const createRes = await makeRequest(apiUrl, '/api/invoices', {
    method: 'POST',
    body: JSON.stringify({
      sellerPublicKey,
      amount: Number(amount),
      assetCode: 'XLM',
      description: 'End-to-end Testnet smoke invoice',
      network: 'TESTNET',
    }),
  });

  if (createRes.status !== 201 || !createRes.body || !createRes.body.data) {
    throw new Error(`Create invoice failed: status ${createRes.status} ${JSON.stringify(createRes.body)}`);
  }

  const invoiceData = createRes.body.data.invoice || createRes.body.data;
  const invoiceId = invoiceData.id;
  const memo = invoiceData.memo;
  const paymentUrl = createRes.body.data.paymentUrl || invoiceData.paymentUrl || `${apiUrl}/pay/${invoiceId}`;

  if (!invoiceId || !memo) {
    throw new Error(`Created invoice payload missing id or memo: ${JSON.stringify(createRes.body)}`);
  }

  if (typeof paymentUrl !== 'string' || paymentUrl.length === 0) {
    throw new Error(`Payment URL must be a non-empty string`);
  }

  const invalidHash = '0'.repeat(64);
  const negativeVerifyRes = await makeRequest(apiUrl, `/api/invoices/${invoiceId}/verify`, {
    method: 'POST',
    body: JSON.stringify({
      txHash: invalidHash,
      network: 'TESTNET',
    }),
  });

  if (negativeVerifyRes.status < 400) {
    throw new Error(
      `Negative verification guard failed: endpoint returned status ${negativeVerifyRes.status} for invalid tx hash`
    );
  }

  const preVerifyInvoiceRes = await makeRequest(apiUrl, `/api/invoices/${invoiceId}`);
  const preVerifyStatus = preVerifyInvoiceRes.body?.data?.status || preVerifyInvoiceRes.body?.status;
  if (preVerifyStatus !== 'PENDING') {
    throw new Error(`Invoice status mutated to ${preVerifyStatus} after failed verification`);
  }

  let finalTxHash = '';

  if (payerSecret) {
    finalTxHash = await submitTestnetPayment({
      horizonUrl,
      payerSecret,
      destinationPublicKey: sellerPublicKey,
      amount,
      memo,
    });

    const verifyRes = await makeRequest(apiUrl, `/api/invoices/${invoiceId}/verify`, {
      method: 'POST',
      body: JSON.stringify({
        txHash: finalTxHash,
        network: 'TESTNET',
      }),
    });

    if (verifyRes.status !== 200 || verifyRes.body?.data?.status !== 'PAID') {
      throw new Error(`Positive verify failed: status ${verifyRes.status} ${JSON.stringify(verifyRes.body)}`);
    }
  } else if (fixtureTxHash) {
    finalTxHash = fixtureTxHash;
    const verifyRes = await makeRequest(apiUrl, `/api/invoices/${invoiceId}/verify`, {
      method: 'POST',
      body: JSON.stringify({
        txHash: finalTxHash,
        network: 'TESTNET',
      }),
    });

    if (verifyRes.status !== 200 || verifyRes.body?.data?.status !== 'PAID') {
      throw new Error(`Fixture verify failed: status ${verifyRes.status} ${JSON.stringify(verifyRes.body)}`);
    }
  } else if (simulate) {
    const simulateRes = await makeRequest(apiUrl, `/api/invoices/${invoiceId}/simulate-payment`, {
      method: 'POST',
    });

    if (simulateRes.status !== 200) {
      throw new Error(`Payment simulation failed: status ${simulateRes.status} ${JSON.stringify(simulateRes.body)}`);
    }

    finalTxHash =
      simulateRes.body?.data?.paymentTxHash ||
      simulateRes.body?.data?.txHash ||
      `SIMULATED_${invoiceId.slice(0, 8).toUpperCase()}`;
  }

  const rereadRes = await makeRequest(apiUrl, `/api/invoices/${invoiceId}`);
  if (rereadRes.status !== 200) {
    throw new Error(`Re-reading invoice failed: status ${rereadRes.status}`);
  }

  const finalInvoice = rereadRes.body?.data || rereadRes.body;
  if (finalInvoice.status !== 'PAID') {
    throw new Error(`Invoice status in storage is ${finalInvoice.status}, expected PAID`);
  }

  const explorerUrl = `https://stellar.expert/explorer/testnet/tx/${finalTxHash}`;

  const summary = {
    invoiceId,
    status: finalInvoice.status,
    paymentUrl,
    amount,
    memo,
    txHash: finalTxHash,
    explorerUrl,
  };

  return summary;
}

/**
 * Prints the reviewer formatted summary to standard output.
 *
 * @param {Record<string, any>} summary - Smoke test summary data.
 */
export function printReviewerSummary(summary) {
  console.log('\n======================================================================');
  console.log('TESTNET SMOKE TEST SUMMARY (REVIEWER COPY-PASTE)');
  console.log('======================================================================');
  console.log(`Invoice ID:       ${summary.invoiceId}`);
  console.log(`Status:           ${summary.status}`);
  console.log(`Payment Link:     ${summary.paymentUrl}`);
  console.log(`Amount:           ${summary.amount} XLM`);
  console.log(`Memo:             ${summary.memo}`);
  console.log(`Transaction Hash: ${summary.txHash}`);
  console.log(`Stellar Explorer: ${summary.explorerUrl}`);
  console.log('======================================================================\n');
}

/**
 * CLI entrypoint.
 */
async function main() {
  const config = parseConfig();

  if (config.showHelp) {
    console.log(`Usage: node scripts/testnet-smoke.mjs [options]

Options:
  --api-url <url>           Base API URL (default: http://127.0.0.1:3001)
  --seller <publicKey>      Seller Stellar public key
  --payer-secret <secret>   Payer secret for submitting real testnet payment
  --fixture-tx-hash <hash>  Pre-existing testnet tx hash matching invoice
  --simulate                Use /simulate-payment endpoint for offline dev testing
  --horizon-url <url>       Horizon URL (default: https://horizon-testnet.stellar.org)
  --amount <amount>         Invoice XLM amount (default: 1)
  --help, -h                Show this help message

Environment variables:
  SMOKE_API_URL, API_URL
  SMOKE_SELLER_PUBLIC_KEY, SELLER_PUBLIC_KEY
  SMOKE_PAYER_SECRET, PAYER_SECRET
  SMOKE_FIXTURE_TX_HASH, FIXTURE_TX_HASH
  SMOKE_SIMULATE, ALLOW_SIMULATE
  STELLAR_HORIZON_URL
`);
    process.exit(0);
  }

  try {
    const summary = await runSmokeTest(config);
    printReviewerSummary(summary);
    process.exit(0);
  } catch (error) {
    console.error('Smoke test execution failed:', error.message || error);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('testnet-smoke.mjs');
if (isDirectRun) {
  main();
}
