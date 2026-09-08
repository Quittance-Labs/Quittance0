'use client';

import { FileText, Mail } from 'lucide-react';
import PaymentReceipt from './PaymentReceipt';
import type { PayPageInvoice } from './pay-page.types';

interface PayProofPanelProps {
  invoice: PayPageInvoice;
  onDownload: () => void;
  onEmail: () => void;
}

export default function PayProofPanel({ invoice, onDownload, onEmail }: PayProofPanelProps) {
  return (
    <section aria-label="Payment proof" className="space-y-4">
      <PaymentReceipt invoice={invoice} />
      <div className="card flex gap-2 print:hidden">
        <button type="button" onClick={onDownload} className="btn btn-primary flex-1 flex items-center justify-center gap-2">
          <FileText className="w-4 h-4" /> Download Proof
        </button>
        <button type="button" onClick={onEmail} disabled={!invoice.customerEmail} className="btn btn-outline px-4" aria-label="Email proof">
          <Mail className="w-4 h-4" />
        </button>
      </div>
    </section>
  );
}
