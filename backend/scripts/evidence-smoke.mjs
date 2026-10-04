import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as StellarSdk from '@stellar/stellar-sdk';
import {
  evidenceConfig,
  publicArtifact,
  resolveFromScript,
  updateEvidenceMarkdown,
} from './evidence-lib.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`Usage: npm run evidence:smoke -- [--write-evidence]

Required: EVIDENCE_API_URL, EVIDENCE_SELLER_PUBLIC_KEY, EVIDENCE_PAYER_SECRET
Seller auth: EVIDENCE_SELLER_SECRET or an unexpired EVIDENCE_SELLER_SESSION_TOKEN
For --write-evidence: EVIDENCE_FRONTEND_URL, EVIDENCE_SOURCE_REVISION
Optional: EVIDENCE_AMOUNT, EVIDENCE_HORIZON_URL, EVIDENCE_OUTPUT`);
  process.exit(0);
}

async function main() {
  const config = evidenceConfig(process.env, args);
  let sellerSessionToken = process.env.EVIDENCE_SELLER_SESSION_TOKEN;
  const sellerSecret = process.env.EVIDENCE_SELLER_SECRET;
  if (!sellerSessionToken && !sellerSecret) throw new Error('Seller auth requires EVIDENCE_SELLER_SECRET or EVIDENCE_SELLER_SESSION_TOKEN (docs/SELLER_AUTH.md)');
  const payer = StellarSdk.Keypair.fromSecret(config.payerSecret);
  StellarSdk.Keypair.fromPublicKey(config.sellerPublicKey);
  if (payer.publicKey() === config.sellerPublicKey) {
    throw new Error('Seller and payer must be different Testnet accounts');
  }

  const horizon = new StellarSdk.Horizon.Server(config.horizonUrl);

  /** One HTTP call, with the status left intact for the caller to judge. */
  const send = async (route, options = {}) => {
    const response = await fetch(config.apiUrl + route, {
      signal: AbortSignal.timeout(20_000),
      ...options,
      headers: { accept: 'application/json', 'content-type': 'application/json', ...options.headers },
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  };

  const request = async (route, options = {}) => {
    const result = await send(route, options);
    if (!result.ok) {
      throw new Error((options.method || 'GET') + ' ' + route + ' -> ' +
        result.status + ': ' + JSON.stringify(result.body));
    }
    return result.body;
  };

  const health = await request('/health');
  if (health.status !== 'ok' || health.network !== 'TESTNET' || health.simulationEnabled) {
    throw new Error('API health must be ok on TESTNET with simulation disabled');
  }
  const readiness = await request('/ready');
  if (readiness.status !== 'ready' || readiness.ready !== true) {
    throw new Error('API readiness did not confirm ready=true');
  }

  if (!sellerSessionToken) {
    const seller = StellarSdk.Keypair.fromSecret(sellerSecret);
    if (seller.publicKey() !== config.sellerPublicKey) throw new Error('Evidence seller secret does not match the configured public key');
    const issued = await request('/auth/challenge?account=' + encodeURIComponent(config.sellerPublicKey) + '&network=TESTNET');
    const challenge = issued?.data;
    if (challenge?.network !== 'TESTNET' || challenge?.networkPassphrase !== StellarSdk.Networks.TESTNET) {
      throw new Error('Seller challenge must use the pinned Testnet passphrase');
    }
    const parsed = StellarSdk.WebAuth.readChallengeTx(
      challenge.transaction, challenge.serverSigningKey, StellarSdk.Networks.TESTNET,
      challenge.homeDomain, challenge.webAuthDomain,
    );
    const minTime = Number(parsed.tx.timeBounds?.minTime);
    const maxTime = Number(parsed.tx.timeBounds?.maxTime);
    if (parsed.clientAccountID !== config.sellerPublicKey || maxTime !== challenge.expiresAt ||
        maxTime <= Date.now() / 1000 || maxTime - minTime > 300) {
      throw new Error('Seller challenge account or lifetime is invalid');
    }
    parsed.tx.sign(seller);
    const authenticated = await request('/auth/session', {
      method: 'POST', body: JSON.stringify({ transaction: parsed.tx.toXDR(), network: 'TESTNET' }),
    });
    if (authenticated?.data?.sellerPublicKey !== config.sellerPublicKey ||
        authenticated?.data?.network !== 'TESTNET' || typeof authenticated?.data?.token !== 'string') {
      throw new Error('Seller session does not match the evidence account');
    }
    sellerSessionToken = authenticated.data.token;
  }

  await horizon.loadAccount(config.sellerPublicKey);
  const payerAccount = await horizon.loadAccount(payer.publicKey());
  const created = await request('/invoices', {
    method: 'POST',
    headers: { authorization: `Bearer ${sellerSessionToken}` },
    body: JSON.stringify({
      amount: Number(config.amount),
      assetCode: 'XLM',
      description: 'SCF evidence ' + new Date().toISOString(),
      sellerPublicKey: config.sellerPublicKey,
      network: 'TESTNET',
    }),
  });
  const invoice = created?.data?.invoice;
  if (!invoice?.id || !invoice?.memo || invoice.status !== 'PENDING') {
    throw new Error('Create invoice did not return a PENDING invoice with id and memo');
  }

  // The step after create in the reviewer path is the pay link the buyer
  // receives, so a create that returns no reachable link is a broken loop even
  // though the invoice exists (issue #429).
  const paymentInfo = await request('/invoices/' + invoice.id + '/payment-info');
  const payUrl = paymentInfo?.data?.paymentUrl;
  if (typeof payUrl !== 'string' || !payUrl.includes(invoice.id)) {
    throw new Error('Payment info did not return a pay link for invoice ' + invoice.id);
  }

  const transaction = new StellarSdk.TransactionBuilder(payerAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(StellarSdk.Operation.payment({
      destination: config.sellerPublicKey,
      asset: StellarSdk.Asset.native(),
      amount: config.amount,
    }))
    .addMemo(StellarSdk.Memo.text(invoice.memo))
    .setTimeout(120)
    .build();
  transaction.sign(payer);
  const submitted = await horizon.submitTransaction(transaction);

  const verified = await request('/invoices/' + invoice.id + '/verify', {
    method: 'POST',
    body: JSON.stringify({ txHash: submitted.hash, network: 'TESTNET' }),
  });
  const finalInvoice = verified?.data;
  if (finalInvoice?.status !== 'PAID' || finalInvoice.paymentTxHash !== submitted.hash) {
    throw new Error('Verify did not return PAID with the submitted transaction hash');
  }

  const reread = await request('/invoices/' + invoice.id);
  if (reread?.data?.status !== 'PAID' || reread.data.paymentTxHash !== submitted.hash) {
    throw new Error('Paid state did not survive a fresh API read');
  }

  /*
   * A verify that accepted anything would make the PAID assertion above
   * meaningless: the same run would pass whether or not memo matching worked.
   * This second invoice is offered the transaction that settled the first, so
   * its memo names another invoice and the API has to refuse it.
   */
  const unrelated = await request('/invoices', {
    method: 'POST',
    headers: { authorization: `Bearer ${sellerSessionToken}` },
    body: JSON.stringify({
      amount: Number(config.amount),
      assetCode: 'XLM',
      description: 'SCF evidence negative verify ' + new Date().toISOString(),
      sellerPublicKey: config.sellerPublicKey,
      network: 'TESTNET',
    }),
  });
  const unrelatedInvoice = unrelated?.data?.invoice;
  if (!unrelatedInvoice?.id) {
    throw new Error('Create invoice (negative verify) did not return an invoice id');
  }

  const rejection = await send('/invoices/' + unrelatedInvoice.id + '/verify', {
    method: 'POST',
    body: JSON.stringify({ txHash: submitted.hash, network: 'TESTNET' }),
  });
  if (rejection.ok) {
    throw new Error(
      'Verify accepted a transaction whose memo belongs to another invoice ' +
      '(invoice ' + unrelatedInvoice.id + ', tx ' + submitted.hash + ')'
    );
  }

  const artifact = publicArtifact(config, {
    capturedAt: new Date().toISOString(),
    invoiceId: invoice.id,
    memo: invoice.memo,
    payerPublicKey: payer.publicKey(),
    txHash: submitted.hash,
    finalStatus: reread.data.status,
    payUrl,
    checks: {
      health: true,
      readiness: true,
      createdPending: true,
      payLinkReturned: true,
      paymentSubmitted: true,
      verifiedPaid: true,
      rereadPaid: true,
      negativeVerifyRejected: true,
      simulationDisabled: true,
    },
  });

  const outputPath = path.resolve(process.cwd(), config.outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(artifact, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });

  if (config.writeEvidence) {
    const evidencePath = resolveFromScript(import.meta.url, '../../EVIDENCE.md');
    const markdown = await readFile(evidencePath, 'utf8');
    await writeFile(evidencePath, updateEvidenceMarkdown(markdown, artifact), 'utf8');
  }

  /*
   * The reviewer copies these into EVIDENCE.md and the issue thread, so they
   * are printed as labelled lines rather than left inside the JSON artifact.
   */
  console.log('Evidence smoke passed.');
  console.log('  Invoice ID:  ' + invoice.id);
  console.log('  Status:      ' + artifact.finalStatus);
  console.log('  Pay link:    ' + payUrl);
  console.log('  Amount:      ' + artifact.amount + ' ' + artifact.asset);
  console.log('  Memo:        ' + artifact.memo);
  console.log('  Tx hash:     ' + artifact.txHash);
  console.log('  Explorer:    ' + artifact.explorerUrl);
  console.log('  Rejected a foreign transaction on invoice ' + unrelatedInvoice.id +
    ' with HTTP ' + rejection.status + ' (' + (rejection.body?.code || 'no code') + ')');
  console.log('  Artifact:    ' + outputPath);
  if (config.writeEvidence) console.log('Updated EVIDENCE.md');
}

main().catch(error => {
  console.error('Evidence smoke failed: ' + (error?.message || error));
  process.exit(1);
});
