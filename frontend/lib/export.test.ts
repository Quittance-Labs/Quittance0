import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeHtml, generateInvoicePDF } from './export';

test('escapeHtml escapes characters that can create HTML markup', () => {
  assert.equal(
    escapeHtml(`<script data-name="O'Reilly">&</script>`),
    '&lt;script data-name=&quot;O&#39;Reilly&quot;&gt;&amp;&lt;/script&gt;'
  );
});

test('generateInvoicePDF renders invoice fields as literal text', () => {
  const injection = `<script>alert("proof")</script>`;
  const boldText = `<b>literal</b> & "quoted" 'text'`;
  const html = generateInvoicePDF({
    id: `invoice-${injection}`,
    amount: 42,
    assetCode: `USDC${injection}`,
    description: injection,
    customerName: boldText,
    customerEmail: `client+${injection}@example.com`,
    sellerName: injection,
    sellerEmail: `seller+${injection}@example.com`,
    payerName: boldText,
    payerEmail: `payer+${injection}@example.com`,
    status: 'PAID',
    createdAt: '2026-07-18T10:00:00.000Z',
    expiresAt: '2026-07-19T10:00:00.000Z',
    paidAt: '2026-07-18T11:00:00.000Z',
    memo: injection,
    sellerPublicKey: `GSELLER${injection}`,
    payerPublicKey: `GPAYER${injection}`,
    paymentTxHash: `hash-${injection}`,
  });

  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<b>literal<\/b>/i);
  assert.match(html, /&lt;script&gt;alert\(&quot;proof&quot;\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;literal&lt;\/b&gt; &amp; &quot;quoted&quot; &#39;text&#39;/);
});
