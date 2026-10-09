import assert from 'node:assert/strict';
import { it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { InvoiceService } from '../src/services/invoice.service';

it('PostgreSQL preserves one claimable event across concurrent writers and a new connection', {
  skip: process.env.DATABASE_URL ? false : 'DATABASE_URL is not set',
}, async () => {
  // An isolated schema keeps this check independent of other integration jobs.
  const schema = `q585_claimable_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: process.env.DATABASE_URL });
  let writer: Pool | undefined;
  let reader: Pool | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const options = { connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema},public` };
    writer = new Pool(options);
    const sql = readFileSync(path.join(__dirname, '../../db/schema.sql'), 'utf8');
    await writer.query(sql);
    await writer.query(sql); // deployed schema replay must retain the partial index
    const service = new InvoiceService(writer);
    const invoice = await service.createInvoice({
      sellerPublicKey: 'GAYF33NNNMI2Z6VNRFXQ64D4E4SF77PM46NW3ZUZEEU5X7FCHAZCMHKU',
      amount: 12.33, assetCode: 'XLM',
    });
    const event = { balanceId: 'test-balance-585', amount: '12.3300000', asset: 'native', predicate: { unconditional: true } };
    await Promise.all(Array.from({ length: 4 }, () => service.logPaymentEvent(invoice.id, 'CLAIMABLE_BALANCE_RECEIVED', event)));
    await writer.end();
    writer = undefined;

    reader = new Pool(options);
    const restarted = new InvoiceService(reader);
    await restarted.logPaymentEvent(invoice.id, 'CLAIMABLE_BALANCE_RECEIVED', event);
    let events = await restarted.getPaymentEvents(invoice.id);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].eventData, event);
    assert.equal((await restarted.getInvoiceById(invoice.id))?.status, 'PENDING');

    await restarted.logPaymentEvent(invoice.id, 'CLAIMABLE_BALANCE_RECEIVED', { ...event, balanceId: 'second-balance-585' });
    await restarted.logPaymentEvent(invoice.id, 'PAYMENT_REJECTED', { balanceId: event.balanceId });
    await restarted.logPaymentEvent(invoice.id, 'PAYMENT_REJECTED', { balanceId: event.balanceId });
    events = await restarted.getPaymentEvents(invoice.id);
    assert.equal(events.filter((entry) => entry.eventType === 'CLAIMABLE_BALANCE_RECEIVED').length, 2);
    assert.equal(events.filter((entry) => entry.eventType === 'PAYMENT_REJECTED').length, 2, 'the index applies only to claim hints');
  } finally {
    await writer?.end();
    await reader?.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
