import type { Request, Response } from 'express';
import { z } from 'zod';
import type { InvoiceStorage } from '../storage/invoice-storage';
import { sendFailure, sendSuccess } from '../types/api';
import {
  emitEvent,
  emitOperationalFailure,
  logReference,
  operationalLogContext,
} from '../observability/log-events';

const proofHandoffSchema = z.union([
  z.object({ proofFormat: z.literal('pdf'), handoff: z.literal('print-window') }).strict(),
  z.object({ proofFormat: z.literal('text'), handoff: z.literal('download') }).strict(),
]);

/** Public pay-page observation only; never changes invoice or payment state. */
export function createProofHandoffHandler(storage: InvoiceStorage) {
  return async (req: Request, res: Response): Promise<void> => {
    res.setHeader('Cache-Control', 'no-store');
    const parsed = proofHandoffSchema.safeParse(req.body);
    if (!parsed.success) return sendFailure(res, 400, 'Invalid proof handoff');

    try {
      const invoice = await storage.getInvoiceById(req.params.id);
      if (!invoice) return sendFailure(res, 404, 'Invoice not found');
      // Matches the existing browser proof policy; this is not a new payment
      // verdict and does not accept invoice status or identifiers in the body.
      if (invoice.status !== 'PAID') {
        return sendFailure(res, 409, 'Payment proof is available only after the invoice is paid');
      }

      emitEvent('info', 'proof.handoff', operationalLogContext(), {
        invoiceRef: logReference(invoice.id),
        txRef: logReference(invoice.paymentTxHash),
        proofFormat: parsed.data.proofFormat,
        handoff: parsed.data.handoff,
      });
      sendSuccess(res, 202, { accepted: true });
    } catch {
      // Even a failed log sink must leave this best-effort route bounded. The
      // browser has already handed off the proof and never retries this call.
      try { emitOperationalFailure('proof.handoff'); } catch { /* unavailable sink */ }
      sendFailure(res, 503, 'Proof handoff observation unavailable');
    }
  };
}
