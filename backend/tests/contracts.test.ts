import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createInvoiceSchema,
  paymentSchema,
  stellarPublicKeySchema,
  invoiceStatusSchema,
  invoiceSchema,
  verifyResultSchema,
  createApiResponseSchema,
} from '../src/utils/validation';
import type { Invoice, VerifyResult, ApiResponse, CreateInvoiceRequest } from '../src/utils/validation';

describe('Shared Invoice API Contracts', () => {
  const validPublicKey = 'GD3DY5W4K4C37Y32F3DZY6QJ23F4Z77L3HRLW2XN2J6L6K6Z5Y2P2K4A';
  const validPayerKey = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

  describe('Stellar Public Key Schema', () => {
    it('accepts valid 56-character base32 Stellar public key', () => {
      const result = stellarPublicKeySchema.safeParse(validPublicKey);
      assert.equal(result.success, true);
    });

    it('rejects invalid public key lengths or characters', () => {
      assert.equal(stellarPublicKeySchema.safeParse('INVALID').success, false);
      assert.equal(stellarPublicKeySchema.safeParse('S' + validPublicKey.slice(1)).success, false);
      assert.equal(stellarPublicKeySchema.safeParse(validPublicKey + '1').success, false);
    });
  });

  describe('Create Invoice Schema', () => {
    it('validates a complete valid invoice creation request', () => {
      const payload: CreateInvoiceRequest = {
        amount: 150.75,
        assetCode: 'XLM',
        description: 'Web development services',
        customerName: 'Alice',
        customerEmail: 'alice@example.com',
        sellerName: 'Bob Dev',
        sellerEmail: 'bob@example.com',
        expiresInDays: 14,
        sellerPublicKey: validPublicKey,
      };

      const result = createInvoiceSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('rejects non-positive amounts and missing seller keys', () => {
      assert.equal(createInvoiceSchema.safeParse({ amount: -10, sellerPublicKey: validPublicKey }).success, false);
      assert.equal(createInvoiceSchema.safeParse({ amount: 0, sellerPublicKey: validPublicKey }).success, false);
      assert.equal(createInvoiceSchema.safeParse({ amount: 100 }).success, false);
    });

    it('accepts optional empty string emails gracefully', () => {
      const result = createInvoiceSchema.safeParse({
        amount: 50,
        sellerPublicKey: validPublicKey,
        customerEmail: '',
        sellerEmail: '',
      });
      assert.equal(result.success, true);
    });
  });

  describe('Payment Verification Schema', () => {
    it('validates a correct payment payload', () => {
      const payload = {
        invoiceId: '123e4567-e89b-12d3-a456-426614174000',
        txHash: 'a'.repeat(64),
        payerPublicKey: validPayerKey,
        amount: 150.75,
        payerName: 'Alice',
        payerEmail: 'alice@example.com',
      };

      const result = paymentSchema.safeParse(payload);
      assert.equal(result.success, true);
    });

    it('rejects invalid uuid or txHash length', () => {
      assert.equal(paymentSchema.safeParse({
        invoiceId: 'not-a-uuid',
        txHash: 'a'.repeat(64),
        payerPublicKey: validPayerKey,
        amount: 10,
      }).success, false);

      assert.equal(paymentSchema.safeParse({
        invoiceId: '123e4567-e89b-12d3-a456-426614174000',
        txHash: 'short-hash',
        payerPublicKey: validPayerKey,
        amount: 10,
      }).success, false);
    });
  });

  describe('Canonical Invoice Schema & Response Envelopes', () => {
    it('guards canonical invoice shape', () => {
      const sampleInvoice: Invoice = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        sellerPublicKey: validPublicKey,
        sellerName: 'Bob Dev',
        amount: 100,
        assetCode: 'XLM',
        memo: 'INV-TEST-001',
        status: 'PAID',
        paymentTxHash: 'b'.repeat(64),
        payerPublicKey: validPayerKey,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      };

      const parseResult = invoiceSchema.safeParse(sampleInvoice);
      assert.equal(parseResult.success, true);
    });

    it('guards API response envelope and verify response shape', () => {
      const verifyResponse: ApiResponse<VerifyResult> = {
        success: true,
        data: {
          valid: true,
          txHash: 'c'.repeat(64),
          invoice: {
            id: '123e4567-e89b-12d3-a456-426614174000',
            sellerPublicKey: validPublicKey,
            amount: 50,
            assetCode: 'USDC',
            memo: 'INV-TEST-002',
            status: 'PAID',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
        },
      };

      const envelopeSchema = createApiResponseSchema(verifyResultSchema);
      const parseResult = envelopeSchema.safeParse(verifyResponse);
      assert.equal(parseResult.success, true);
    });
  });
});
