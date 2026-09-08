'use client';

import { Copy } from 'lucide-react';
import type { PayPageInvoice } from './pay-page.types';

interface PayMemoBlockProps {
  invoice: PayPageInvoice;
  onCopy: (value: string, label: string) => void;
}

function CopyRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
  return (
    <div>
      <p className="text-xs text-gray-600 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs bg-white p-2 rounded border truncate">{value}</code>
        <button type="button" aria-label={`Copy ${label.toLowerCase()}`} onClick={onCopy} className="p-2 hover:bg-gray-200 rounded">
          <Copy className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function PayMemoBlock({ invoice, onCopy }: PayMemoBlockProps) {
  return (
    <section aria-label="Payment information" className="bg-gray-50 p-4 rounded-lg space-y-3 border">
      <h3 className="font-semibold text-gray-900">Payment Information</h3>
      {invoice.status === 'PENDING' && (
        <CopyRow label="Destination address" value={invoice.sellerPublicKey} onCopy={() => onCopy(invoice.sellerPublicKey, 'Address')} />
      )}
      <CopyRow label="Memo (required)" value={invoice.memo} onCopy={() => onCopy(invoice.memo, 'Memo')} />
      {invoice.status === 'PENDING' && (
        <CopyRow label="Exact amount" value={`${invoice.amount} ${invoice.assetCode}`} onCopy={() => onCopy(String(invoice.amount), 'Amount')} />
      )}
    </section>
  );
}
