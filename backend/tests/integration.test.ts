import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { server } from '../src/server-mvp.ts';

const PORT = process.env.PORT || 3001;
const BASE_URL = `http://localhost:${PORT}`;

describe('Invoice Integration Test', () => {
  after(() => {
    server.close();
  });

  it('create invoice (memory backend) -> verify mocked tx -> status PAID', async () => {
    // 1. Create invoice
    const createRes = await fetch(`${BASE_URL}/api/invoices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: 100,
        assetCode: 'USDC',
        sellerPublicKey: 'GCNZ4W4N5MAB37GZ3UKOIVQ2Z3G7E5E5SJZ6I5Z6I5Z6I5Z6I5Z6I5Z6',
        description: 'Test Invoice',
      }),
    });
    
    const createBody = await createRes.json();
    assert.equal(createRes.status, 201, `Expected 201, got ${createRes.status}. Body: ${JSON.stringify(createBody)}`);
    assert.equal(createBody.success, true);
    
    const invoiceId = createBody.data.invoice.id;
    assert.ok(invoiceId);
    assert.equal(createBody.data.invoice.status, 'PENDING', `Expected PENDING, got ${createBody.data.invoice.status}`);
    
    // 2. Verify mocked tx
    const simRes = await fetch(`${BASE_URL}/api/invoices/${invoiceId}/simulate-payment`, {
      method: 'POST',
    });
    
    const simBody = await simRes.json();
    assert.equal(simRes.status, 200, `Expected 200, got ${simRes.status}. Body: ${JSON.stringify(simBody)}`);
    assert.equal(simBody.success, true);
    assert.equal(simBody.data.status, 'PAID', `Expected PAID, got ${simBody.data.status}`);
    
    // 3. Verify status is PAID by fetching again
    const getRes = await fetch(`${BASE_URL}/api/invoices/${invoiceId}`);
    const getBody = await getRes.json();
    assert.equal(getRes.status, 200);
    assert.equal(getBody.success, true);
    assert.equal(getBody.data.status, 'PAID', `Expected PAID, got ${getBody.data.status}`);
  });
});
