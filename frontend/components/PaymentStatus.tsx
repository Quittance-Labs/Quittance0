'use client';

import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { getExplorerTransactionUrl } from '@/lib/stellar';

interface PaymentStatusProps {
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'CANCELLED';
  txHash?: string;
  /** Removes the large card/icon treatment when embedded in payment details. */
  compact?: boolean;
}

export default function PaymentStatus({ status, txHash, compact = false }: PaymentStatusProps) {
  const getStatusIcon = () => {
    switch (status) {
      case 'PAID':
        return <CheckCircle className="w-16 h-16 text-green-500" />;
      case 'EXPIRED':
        return <XCircle className="w-16 h-16 text-red-500" />;
      case 'CANCELLED':
        return <XCircle className="w-16 h-16 text-gray-500" />;
      default:
        return <Clock className="w-16 h-16 text-yellow-500" />;
    }
  };

  const getStatusMessage = () => {
    switch (status) {
      case 'PAID':
        return {
          title: 'Payment Successful!',
          description: 'This invoice has been paid.',
          color: 'text-green-600',
        };
      case 'EXPIRED':
        return {
          title: 'Invoice Expired',
          description: 'The payment window ended. This record remains available for reference.',
          color: 'text-red-600',
        };
      case 'CANCELLED':
        return {
          title: 'Invoice Cancelled',
          description: 'This invoice has been cancelled.',
          color: 'text-gray-600',
        };
      default:
        return {
          title: 'Waiting for Payment',
          description: 'Complete the payment to proceed.',
          color: 'text-yellow-600',
        };
    }
  };

  const statusInfo = getStatusMessage();
  return (
    <div className={compact ? 'pay-status-compact text-center' : 'card text-center'}>
      <div className="flex flex-col items-center gap-4">
        {!compact && getStatusIcon()}
        
        <div>
          <h2 className={`text-2xl font-bold ${statusInfo.color}`}>
            {statusInfo.title}
          </h2>
          <p className="text-gray-600 mt-2">{statusInfo.description}</p>
        </div>

        {txHash && (
          <a
            href={getExplorerTransactionUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-outline mt-4"
          >
            View on Stellar Explorer
          </a>
        )}
      </div>
    </div>
  );
}
