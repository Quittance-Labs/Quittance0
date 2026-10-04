import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLogRecord,
  LOG_EVENTS,
  logReference,
  requiredLogFields,
} from '../src/observability/log-events';

describe('structured log event contract', () => {
  it('keeps the invoice loop taxonomy stable', () => {
    assert.deepEqual(LOG_EVENTS, [
      'invoice.create.started',
      'invoice.create.succeeded',
      'invoice.create.rejected',
      'payment.attempt.started',
      'payment.attempt.submitted',
      'payment.attempt.rejected',
      'payment.verify.started',
      'payment.verify.rejected',
      'invoice.paid',
      'proof.downloaded',
      'proof.handoff',
      'horizon.request.failed',
      'http.request.completed',
      'operation.failed',
      'payment.verify.cached',
    ]);
  });

  it('retains only fields allowed for the event', () => {
    const record = buildLogRecord(
      'warn',
      'payment.verify.rejected',
      { requestId: 'req-123', service: 'api', environment: 'test' },
      {
        invoiceRef: 'inv-a1',
        txRef: 'tx-b2',
        errorCode: 'MEMO_MISMATCH',
        network: 'TESTNET',
        durationMs: 17,
        sellerPublicKey: 'GRAW',
        payerPublicKey: 'GOTHER',
        customerEmail: 'person@example.com',
        memo: 'private memo',
        xdr: 'AAAA-secret-payload',
        amount: '42.00',
      },
      new Date('2026-09-13T10:00:00.000Z')
    );

    assert.deepEqual(record, {
      timestamp: '2026-09-13T10:00:00.000Z',
      level: 'warn',
      event: 'payment.verify.rejected',
      requestId: 'req-123',
      service: 'api',
      environment: 'test',
      invoiceRef: 'inv-a1',
      txRef: 'tx-b2',
      errorCode: 'MEMO_MISMATCH',
      network: 'TESTNET',
      durationMs: 17,
    });
  });

  it('creates deterministic keyed references and fails closed without a key', () => {
    const first = logReference('invoice-123', 'deployment-secret');
    const second = logReference('invoice-123', 'deployment-secret');
    const other = logReference('invoice-456', 'deployment-secret');

    assert.match(first, /^[0-9a-f]{16}$/);
    assert.equal(first, second);
    assert.notEqual(first, other);
    assert.equal(logReference('invoice-123', ''), 'redacted');
    assert.equal(logReference(undefined, 'deployment-secret'), 'redacted');
  });

  it('declares required event fields without PII names', () => {
    const forbidden = /email|name|memo|address|publicKey|secret|xdr|uri|amount/i;
    for (const event of LOG_EVENTS) {
      for (const field of requiredLogFields(event)) {
        assert.doesNotMatch(field, forbidden);
      }
    }
  });
});
