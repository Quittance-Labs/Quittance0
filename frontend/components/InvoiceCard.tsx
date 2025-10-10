'use client';

import Link from 'next/link';
import { formatAmount, formatDate, getStatusColor, getTimeRemaining } from '@/lib/utils';
import { Clock, ExternalLink, Copy } from 'lucide-react';
import { copyToClipboard } from '@/lib/utils';
import { toast } from 'sonner';

interface Invoice {
  id: string;
  amount: number;
  assetCode: string;
  description?: string;
  customerName?: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  memo: string;
}

interface InvoiceCardProps {
  invoice: Invoice;
}

export default function InvoiceCard({ invoice }: InvoiceCardProps) {
  const statusColor = getStatusColor(invoice.status);
  const paymentUrl = `${window.location.origin}/pay/${invoice.id}`;

  const handleCopyLink = async () => {
    const success = await copyToClipboard(paymentUrl);
    if (success) {
      toast.success('Payment link copied!');
    }
  };

  return (
    <div className="card hover:shadow-xl transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {formatAmount(invoice.amount)} {invoice.assetCode}
          </h3>
          {invoice.customerName && (
            <p className="text-sm text-gray-600">{invoice.customerName}</p>
          )}
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor}`}>
          {invoice.status}
        </span>
      </div>

      {invoice.description && (
        <p className="text-sm text-gray-600 mb-4 line-clamp-2">
          {invoice.description}
        </p>
      )}

      <div className="space-y-2 mb-4">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Clock className="w-4 h-4" />
          <span>Created: {formatDate(invoice.createdAt)}</span>
        </div>
        {invoice.status === 'PENDING' && (
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Clock className="w-4 h-4" />
            <span>Expires: {getTimeRemaining(invoice.expiresAt)}</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Link
          href={`/invoice/${invoice.id}`}
          className="btn btn-outline flex-1 flex items-center justify-center gap-2"
        >
          <ExternalLink className="w-4 h-4" />
          View
        </Link>
        {invoice.status === 'PENDING' && (
          <button
            onClick={handleCopyLink}
            className="btn btn-secondary flex items-center justify-center gap-2"
          >
            <Copy className="w-4 h-4" />
            Copy Link
          </button>
        )}
      </div>
    </div>
  );
}

