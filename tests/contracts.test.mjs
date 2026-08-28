import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createInvoiceSchema,
  paymentSchema,
  stellarPublicKeySchema,
  invoiceSchema,
  verifyResultSchema,
  createApiResponseSchema,
} from '../shared/src/schemas.js';

const validPublicKey = 'GD3DY5W4K4C37Y32F3DZY6QJ23F4Z77L3HRLW2XN2J6L6K6Z5Y2P2K4A';
const validPayerKey = 'GB6Y4H5Z2A3B4C5D6E7F8G9H0J1K2L3M4N5P6Q7R8S9T0U1V2W3X4Y5Z';

test('stellarPublicKeySchema rejects malformed keys', () => {
  assert.equal(stellarPublicKeySchema.safeParse('INVALID').success, false);
  assert.equal(stellarPublicKeySchema.safeParse(validPublicKey).success, true);
});

test('createInvoiceSchema validates required fields and types', () => {
  const valid = createInvoiceSchema.safeParse({
    amount: 100,
    assetCode: 'XLM',
    sellerPublicKey: validPublicKey,
  });
  assert.equal(valid.success, true);

  const invalid = createInvoiceSchema.safeParse({
    amount: -5,
    sellerPublicKey: validPublicKey,
  });
  assert.equal(invalid.success, false);
});

test('verifyResultSchema guards create + verify response shapes', () => {
  const result = verifyResultSchema.safeParse({
    valid: true,
    txHash: 'a'.repeat(64),
    invoice: {
      id: '123e4567-e89b-12d3-a456-426614174000',
      sellerPublicKey: validPublicKey,
      amount: 100,
      assetCode: 'XLM',
      memo: 'INV-TEST-001',
      status: 'PAID',
      createdAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
    },
  });
  assert.equal(result.success, true);
});
